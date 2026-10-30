#!/usr/bin/env python
"""fall - C-FALL / OD-8 ("fall damage should exist naturally"): real HP damage from high falls, scaled by height; none for ordinary
steps, jumps, ledge drops, water or parachute / glider landings; lethal only from very high falls; armour does not absorb it; the 0.4 s
landing stagger on hard landings; bots get the same rule and avoid lethal drops. (P3 contract C-FALL: constants in sim/royale.js - lane
sim -, application in player.js - lane player.)

    python _harness/p23/fall.py --disk
    python _harness/p23/fall.py --rev 9aa2b746                 # control: the P2 base has no fall damage - MUST FAIL
    python _harness/p23/fall.py --disk --plant no-damage       # K.FALL_SAFE_V = 1e9 - MUST FAIL (10 m drop costs nothing)
    python _harness/p23/fall.py --disk --plant harsh           # K.FALL_DMG_PER_V x 4 - MUST FAIL (10 m drop over the band)
    python _harness/p23/fall.py --disk --plant no-event        # 'fallDamage' never reaches W.events - MUST FAIL
    python _harness/p23/fall.py --disk --plant no-fall-guard --parts lip   # bots.js served with its fall guard off - MUST FAIL (bots-avoid lips)
    python _harness/p23/fall.py --disk --plant bot-curve-x0.6 --parts bots # the bots' fall curve x0.6 - MUST FAIL (bots-rule)
    python _harness/p23/fall.py --disk --inject F:/lc_p23/harness/stubs/fall_stub.js   # validation against a contract stub

Part HUMAN (PRACTICE, Isla Viva seed 4242, kernel loop frozen, frames stepped, the hp guard OFF during each drop): the player is set
h metres above open, flat ground (nothing within 4 m) with zero velocity and stepped until grounded; hp / shield before and after, every
'fallDamage' event. Heights 1, 3, 4, 6, 10 (shield 100 and shield 0), 15, 17, then 22 (lethal) last (D2). 10 REAL Space jumps on the same ground.
A 20 m drop into deep water.
Part BOTS (a QUICK match on Savanna seed 77, ground start): three bots lifted 10 m, three 15 m and three 22 m over open, flat ground (each moved to
the nearest spot that passes the human's flat-ground rule AND lies out of every other actor's fire range and sight for the window first, R3) - the same rule
(10 m costs 35-40, 15 m = the human's, 22 m kills); then 180 s of play through fastForward: 0 bot deaths from a fall.
Part LIP (a QUICK match on Isla Viva seed 77): bots-avoid's falsifier - a dry 10 hp bot provoked by an enemy 9 m behind it on a plateau flees
toward a >= 7 m terrain lip, up to 6 lips x 25 s: 0 die of the fall (--plant no-fall-guard serves bots.js with its C-FALL guard off: MUST FAIL).
Part GLIDE (a STANDARD match, Isla Viva seed 7): the whole drop through fastForward until every actor stands on the ground: 0 fallDamage
events, 0 hp lost without an attacker at touchdown, for the human and all 49 bots.

Rows: contract (K.FALL_SAFE_V, K.FALL_DMG_PER_V, K.LAND_STAGGER_S numbers) - safe-drops (1 / 3 / 4 m: 0 hp) - jumps (0 hp) - ten-metre
(35-40 hp) - fifteen-metre (60-75 hp) - monotonic (damage non-decreasing with height) - lethal (17 m survived, 22 m kills at full shield) - shield-untouched (shield 100 before
= 100 after a 10 m drop, hp loss equal to the shield-0 drop) - event (one 'fallDamage' per damaging landing, none otherwise) - stagger
(after the 10 m landing with W held: horizontal speed <= 50 % of walk over the first 0.3 s, back to >= 85 % of walk by 0.8 s; after a 1 m
drop >= 85 % within 0.3 s) - water (0 hp) - bots-rule - bots-avoid - bots-avoid lips - glide - errors.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    # both the constants and the sim's pure helper (an implementation may read either): a plant must bite on any implementation
    "no-damage": "K.FALL_SAFE_V = 1e9; if (typeof K.fallDamage === 'function') K.fallDamage = () => 0; if (K.FALL) K.FALL.SAFE_V = 1e9",
    "harsh": "K.FALL_DMG_PER_V = (K.FALL_DMG_PER_V || 1) * 4; if (typeof K.fallDamage === 'function') { const f0 = K.fallDamage; K.fallDamage = function () { return 4 * f0.apply(this, arguments); }; } if (K.FALL) K.FALL.DMG_PER_V *= 4",
    "no-event": "const em = W.events.emit.bind(W.events); W.events.emit = function (n) { if (n === 'fallDamage') return; return em.apply(null, arguments); }",
    # bots.js served with its C-FALL guard off (part lip; see NO_FALL_GUARD): no page snippet
    "no-fall-guard": "",
    # R3: the fall curve scaled x0.6 in the bots' page (part bots; registered --parts bots): a 10 m drop costs a bot ~23 hp - bots-rule MUST FAIL
    "bot-curve-x0.6": "{ const f0 = K.fallDamage; if (typeof f0 === 'function') K.fallDamage = function () { return Math.round(0.6 * f0.apply(this, arguments)); }; K.FALL_DMG_PER_V = (K.FALL_DMG_PER_V || 1) * 0.6; if (K.FALL) K.FALL.DMG_PER_V *= 0.6; }",
}
# integrator D2 (fix round, binding): a 10 m drop costs 35-40 hp, 15 m 60-75, lethal from full health from about 20 m (not 16.6 m): 17 m
# survives, 22 m kills (the 4 m safe drop stays). Was 35-50 / 20 m kills before D2
TEN_LO, TEN_HI = 35, 40
FIF_LO, FIF_HI = 60, 75
LIVE_H, DEAD_H = 17, 22

SPOT_JS = r"""([wantWater]) => {
  const W = window.__LC__.W, M = W.map, p = W.player, wy = M.waterY;
  const ok = (x, z) => {
    const h = M.heightAt(x, z);
    if (wantWater) return h < wy - 4;
    if (h < wy + 1) return false;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [6, 0], [0, 6]]) if (Math.abs(M.heightAt(x + dx, z + dz) - h) > 0.25) return false;
    for (const c of M.queryColliders(x, z, 6, [])) { if (c.dead) continue; if (c.maxY > h + 0.2 && c.minX < x + 5 && c.maxX > x - 5 && c.minZ < z + 5 && c.maxZ > z - 5) return false; }
    return true; };
  for (let r = 0; r < 700; r += 6) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
    if (Math.abs(x) < 760 && Math.abs(z) < 760 && ok(x, z)) return { x, z, h: M.heightAt(x, z) };
  }
  return null; }"""

DROP_JS = r"""([x, z, h, hp, sh, maxF, holdW]) => {
  const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__, M = W.map;
  const ev = []; const on = (a, d) => { if (a === p) ev.push({ t: +W.t.toFixed(3), d: typeof d === 'number' ? d : (d && d.dmg != null ? d.dmg : null) }); };
  W.events.on('fallDamage', on);
  const g = M.heightAt(x, z);
  p.pos.set(x, g + h, z); p.vel.set(0, 0, 0); p.onGround = false; p.gliding = false; p.hp = hp; p.shield = sh; if (p.obj) p.obj.position.copy(p.pos);
  let f = 0, land = null; const trace = [];
  while (f < maxF) { P.step(1, 1 / 60, false); f++;
    if (p.onGround || p.swimming || !p.alive) { land = { f, t: +W.t.toFixed(3), x: p.pos.x, z: p.pos.z, swim: !!p.swimming }; break; } }
  const at = { hp: p.hp, shield: p.shield, alive: !!p.alive };
  // after the touchdown: a few frames to let a delayed application land (and the stagger run)
  for (let i = 0; i < 50 && p.alive; i++) { P.step(1, 1 / 60, false); trace.push([+W.t.toFixed(3), p.pos.x, p.pos.z]); }
  W.events.off ? W.events.off('fallDamage', on) : null;
  return { h, land, at, after: { hp: p.hp, shield: p.shield, alive: !!p.alive }, ev, trace }; }"""


def drop(s, spot, h, hp=100, sh=100):
    s.guard_player(False)
    r = s.js(DROP_JS, [spot["x"], spot["z"], h, hp, sh, 900, False])
    r["lost"] = round(hp - r["after"]["hp"], 2) if r["after"]["alive"] else hp
    r["shieldLost"] = round(sh - r["after"]["shield"], 2) if r["after"]["alive"] else None
    return r


STAGGER_JS = r"""([x, z, h]) => {
  const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__, M = W.map;
  p.pos.set(x, M.heightAt(x, z) + h, z); p.vel.set(0, 0, 0); p.onGround = false; p.hp = 100; p.shield = 100; p.input.yaw = 0;
  let f = 0; while (f < 900 && !p.onGround) { P.step(1, 1 / 60, false); f++; }
  const t0 = W.t, x0 = p.pos.x, z0 = p.pos.z; const rows = [];
  for (let i = 0; i < 60; i++) { P.step(1, 1 / 60, false); rows.push([+(W.t - t0).toFixed(3), +Math.hypot(p.pos.x - x0, p.pos.z - z0).toFixed(3)]); }
  return { landedF: f, rows, walk: W.SIM.MOVE.walk }; }"""


def speed_between(rows, a, b):
    rows = [[0.0, 0.0]] + list(rows)
    pa = [r for r in rows if r[0] <= a]
    pb = [r for r in rows if r[0] <= b]
    if not pa or not pb:
        return None
    return (pb[-1][1] - pa[-1][1]) / max(1e-6, pb[-1][0] - pa[-1][0])


def part_human(s, v, args):
    R = v.data.setdefault("human", {})
    spot = s.js(SPOT_JS, [False])
    R["spot"] = spot
    if not spot:
        v.cnj("human drops", "no open flat ground found near the practice spawn")
        return
    rows = {}
    for h in (1, 3, 4, 6):
        rows[h] = drop(s, spot, h)
    rows["10s"] = drop(s, spot, 10, 100, 100)
    rows["10n"] = drop(s, spot, 10, 100, 0)
    rows[15] = drop(s, spot, 15)
    # 10 REAL jumps
    s.guard_player(False)
    s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.hp = 100; p.shield = 100; p.onGround = true; window.__P23J__ = []; window.__P23JN__ = 0; W.events.on('fallDamage', (a) => { if (a === p) window.__P23J__.push(W.t); }); W.events.on('jump', (a) => { if (a === p) window.__P23JN__++; }); }",
         [spot["x"], spot["z"]])
    for _ in range(10):
        s.press("Space", 0.05)
        s.step_frames(60, 1 / 60)
    jumps = s.js("() => ({ hp: window.__LC__.W.player.hp, ev: window.__P23J__.length, jumps: window.__P23JN__ })")
    # stagger (the 10 m landing vs a 1 m landing), W held for real
    s.page.keyboard.down("KeyW")
    st_hard = s.js(STAGGER_JS, [spot["x"], spot["z"], 10])
    st_soft = s.js(STAGGER_JS, [spot["x"], spot["z"], 1])
    s.page.keyboard.up("KeyW")
    wspot = s.js(SPOT_JS, [True])
    rows["water20"] = drop(s, wspot, 20) if wspot else None
    # the two lethal-threshold drops LAST (fix round: a 17 m drop that kills - the pre-D2 curve - left the jumps / stagger / water rows a dead
    # body to measure). 17 m first; if it killed, a fresh practice page for the 22 m drop (else that row would judge a body already dead)
    rows[LIVE_H] = drop(s, spot, LIVE_H)
    if not rows[LIVE_H]["after"]["alive"]:
        R["repractice"] = L.practice(s, 4242, "isla_viva")
        if args.plant:
            L.plant_js(s, PLANTS[args.plant])
        spot = s.js(SPOT_JS, [False]) or spot
    rows[DEAD_H] = drop(s, spot, DEAD_H)
    R["rows"] = {str(k): {kk: vv for kk, vv in r.items() if kk != "trace"} if r else None for k, r in rows.items()}
    lost = {k: (r["lost"] if r else None) for k, r in rows.items()}
    # the curve the bots row compares against (fall_all3 10-26: bots-rule read "human15": null - nothing stored it, so the row fell back to
    # "> 50 hp" instead of the human's own 15 m)
    R["curve"] = {"10": lost.get("10n"), "15": lost.get(15), "6": lost.get(6)}
    v.check("safe-drops (1 / 3 / 4 m cost 0 hp)", all(lost[h] == 0 for h in (1, 3, 4)), {h: lost[h] for h in (1, 3, 4)}, "0")
    v.check("jumps (10 real Space jumps cost 0 hp, 0 events)", jumps["hp"] == 100 and jumps["ev"] == 0 and jumps["jumps"] >= 8, jumps, "hp 100, 0 events, >= 8 jumps happened")
    ten = lost["10n"]
    v.check("ten-metre (a 10 m drop costs %d-%d hp)" % (TEN_LO, TEN_HI), ten is not None and TEN_LO <= ten <= TEN_HI, {"lost": ten}, "%d-%d" % (TEN_LO, TEN_HI))
    fif = lost[15]
    v.check("fifteen-metre (a 15 m drop costs %d-%d hp, D2)" % (FIF_LO, FIF_HI), fif is not None and FIF_LO <= fif <= FIF_HI, {"lost": fif}, "%d-%d" % (FIF_LO, FIF_HI))
    seq = [lost[1], lost[3], lost[4], lost[6], lost["10n"], lost[15], lost[LIVE_H]]
    v.check("monotonic (damage non-decreasing 1 -> %d m)" % LIVE_H, all(a is not None and b is not None and b >= a for a, b in zip(seq, seq[1:])) and lost[15] > lost[6],
            {"1,3,4,6,10,15,%d m" % LIVE_H: seq}, "non-decreasing, 15 m > 6 m")
    rl, rd = rows[LIVE_H], rows[DEAD_H]
    v.check("lethal (D2: from full health a %d m drop is survived, a %d m drop kills; hp 100 + shield 100)" % (LIVE_H, DEAD_H),
            rl["after"]["alive"] and not rd["after"]["alive"], {"%dm" % LIVE_H: {"after": rl["after"], "lost": rl["lost"]}, "%dm" % DEAD_H: {"after": rd["after"], "at": rd["at"]}},
            "%d m alive, %d m dead" % (LIVE_H, DEAD_H))
    r10 = rows["10s"]
    v.check("shield-untouched (armour does not absorb a fall)", r10["after"]["alive"] and r10["shieldLost"] == 0 and r10["lost"] == lost["10n"],
            {"withShield": {"hpLost": r10["lost"], "shieldLost": r10["shieldLost"]}, "noShield": {"hpLost": lost["10n"]}}, "shield 100 -> 100, same hp loss")
    damaging = [k for k in rows if rows[k] and rows[k]["lost"] > 0]
    clean = [k for k in rows if rows[k] and rows[k]["lost"] == 0]
    ev_ok = all(len(rows[k]["ev"]) == 1 for k in damaging if k != DEAD_H) and all(len(rows[k]["ev"]) == 0 for k in clean) and bool(damaging)
    v.check("event (one 'fallDamage' per damaging landing, none otherwise)", ev_ok,
            {str(k): len(rows[k]["ev"]) for k in rows if rows[k]}, "1 per damaging, 0 per clean")
    walk = st_hard["walk"]
    # 0.15-0.35 s: inside the 0.4 s stagger, after ground friction has taken the air-control momentum the fall carried in (W was held
    # through the fall, as a player does; a 0-0.3 s window measured that momentum decay, not the stagger)
    hs = speed_between(st_hard["rows"], 0.15, 0.35)
    hr = speed_between(st_hard["rows"], 0.6, 0.8)
    ss = speed_between(st_soft["rows"], 0.0, 0.3)
    R["stagger"] = {"hard0.15_0.35": hs, "hard0.6_0.8": hr, "soft0_0.3": ss, "walk": walk}
    v.check("stagger (10 m landing: <= 50 % of walk over 0.15-0.35 s, >= 85 % by 0.6-0.8 s; 1 m: >= 85 % at once)",
            None not in (hs, hr, ss) and hs <= 0.50 * walk and hr >= 0.85 * walk and ss >= 0.85 * walk,
            {k: (round(x, 2) if isinstance(x, float) else x) for k, x in R["stagger"].items()}, "stagger only on the hard landing")
    rw = rows["water20"]
    if rw:
        v.check("water (a 20 m drop into deep water costs 0 hp)", rw["after"]["alive"] and rw["lost"] == 0 and (rw["land"] or {}).get("swim"),
                {"lost": rw["lost"], "land": rw["land"]}, "0 hp, swimming")
    else:
        v.cnj("water (a 20 m drop into deep water costs 0 hp)", "no deep water found within 700 m of the practice spawn")


# R3 (gates): the setup's spot must be CLEAR of every other actor for the whole window. On 03a00b05 (ashgrid seed 77) s2 was lifted 21 m to its
# flat spot and into a line of fire: s36 (ENGAGE, 27-29 m) hit it 3x with a pistol (13-14 hp, t 3.25-4.8 s) inside the 6 s window, so tenLost read
# 59 against a recorded fallDmg of 38. A spot is CLEAR when every other live actor (and every test spot already picked) is
#   - out of RANGE for the whole window (REQUIRED): farther than its own longest trigger range (bots.js fireRangeM: falloff[1] x 1.3, 30 m without
#     a falloff, over the guns it carries; at most 200 m: perceive never targets anyone farther) + CLOSE_M = 60 m (6 s x the 8 m/s sprint, W.SIM.MOVE.sprint, = 48 m, + 12 m: the first full run's
#     tightest bot kept only 1 m of the 48 m): it cannot stand inside its range of the
#     test bot at any moment of the window with the guns it carries; checked again over the window: no other actor inside its LIVE trigger
#     range (a gun looted mid-window counts) with a clear sight line to a test bot (`exposed`, else the setup missed), and
#   - out of SIGHT (PREFERRED, `hidden`): farther than PACE.noticeM 200 m + 48 m (bots.js perceive: no tier notices a stranger past 200 m), or its
#     eye's sight line to the drop column (1.2 m, mid-drop, the lift + 1.2 m) blocked (W.map.losBlocked, perceive's sight test). Hidden spots are
#     scarce (43 grid cells at 03a00b05's ground start), so the nearest spot that is both wins, else the nearest out of range.
# (A flat 260 m disc free of every actor does not exist in a 50-actor quick match: the circle is r 588 m, nearest-neighbour median 101 m, 0 grid
# cells qualify - diag F:/lc_p23/r3/gates/diag/spotfeas.py.) Inside the live storm circle - 20 m. The search is a fixed 10 m grid, nearest to the
# bot first: the same seed picks the same spots. The row then judges what the window recorded: hp lost - damage from attackers (actorHurt with an
# attackerId) == the recorded fallDmg, and that fallDmg on the curve. Nine spots clear of each other AND of everyone at once do not exist either (4 of
# 9 found on 03a00b05), so the drops run in three rounds of three (22 / 15 / 10 m), each round its own window.
CLOSE_M, SIGHT_M, WIN_F = 60, 248, 360
BOT_DROP_JS = r"""([rounds, closeM, sightM, winF]) => {
  const W = window.__LC__.W, M = W.map, P = window.__H_PUMP__, K = W.SIM;
  // OPEN, FLAT ground under each bot (release prep): the human's SPOT_JS rule (+- 0.25 m over 6 m, no collider over the ground within 5 m). A bot
  // keeps steering in the air (~3 m in a 10 m fall), and a bot lifted over a slope landed lower than it was lifted: Savanna seed 77 s5, lifted
  // 10 m at (-773, 32), fell 10.47 m downhill = 41-42 hp, which is the curve at 10.5 m, not a 10 m drop.
  const wy = M.waterY;
  const flatOk = (x, z) => { const h = M.heightAt(x, z); if (h < wy + 1) return false;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2], [6, 0], [-6, 0], [0, 6], [0, -6]]) if (Math.abs(M.heightAt(x + dx, z + dz) - h) > 0.25) return false;
    for (const c of M.queryColliders(x, z, 6, [])) { if (c.dead) continue; if (c.maxY > h + 0.2 && c.minX < x + 5 && c.maxX > x - 5 && c.minZ < z + 5 && c.maxZ > z - 5) return false; }
    return true; };
  const reachOf = (a) => { let m = 30; const sl = (a.inventory && a.inventory.slots) || [];
    for (const it of sl) { if (!it || !it.id) continue; let d = K.WEAPONS && K.WEAPONS[it.id]; if (d && !d.falloff && d.like) d = Object.assign({}, K.WEAPONS[d.like], d);
      if (d && d.falloff) m = Math.max(m, d.falloff[1] * 1.3); } return Math.min(m, 200); };   // perceive drops every candidate past 200 m (`if (d > 200) continue`)
  const span = Math.min(740, (M.half || 760) - 20);
  const used = new Set(), rows = [], hurt = [], storms = [];
  // R3: ROUNDS of three drops (22 m, 15 m, 10 m: the tallest drop column, the hardest to hide, picks first), each its own 6 s window; three rounds
  // = 18 s, before the quick storm's first shrink (wait 30 s). Every round re-reads every other actor where it stands.
  for (const hs of rounds) {
    const bots = W.actors.filter((a) => a.isBot && a.alive && a.onGround && !a.gliding && !a.downed && !used.has(a.id)).slice(0, hs.length);
    const ids = new Set(bots.map((b) => b.id)); for (const b of bots) used.add(b.id);
    // CLEAR of every other actor (see CLOSE_M above): every live actor that is not in this round where it stands; a spot of this round joins `taken` once picked
    const others = W.actors.filter((a) => a.alive && !ids.has(a.id)).map((a) => ({ x: a.pos.x, z: a.pos.z, eyes: [a.pos.y + 1.5], reach: reachOf(a) }));
    const taken = [];
    let st = null, st1 = null; try { st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null; st1 = W.stormCtl ? W.stormCtl.storm.stateAt(W.t + winF / 60) : null; } catch (e) { st = st1 = null; }
    storms.push(st ? { t: +W.t.toFixed(2), x: +st.center.x.toFixed(1), z: +st.center.z.toFixed(1), r: +st.radius.toFixed(1), rEnd: st1 ? +st1.radius.toFixed(1) : null } : null);
    // inside the circle for the whole window (its radius at the window's END), 20 m in
    const inCircle = (x, z) => { for (const c of [st, st1]) if (c && c.radius > 0 && Math.hypot(x - c.center.x, z - c.center.z) > c.radius - 20) return false; return true; };
    // OUT OF RANGE (required): every other actor farther than its own trigger range + closeM, so it cannot stand inside it at any moment of the
    // window whatever it sees. OUT OF SIGHT (preferred): its sight line to the drop column blocked as well; the nearest spot that is both wins, else
    // the nearest spot out of range (rows carry `hidden`). The window's postcondition (part_bots) checks the range really held.
    const clearOf = (x, z, h, sight) => { const g = M.heightAt(x, z); let near = 1e9;
      for (const o of others.concat(taken)) { const d = Math.hypot(o.x - x, o.z - z); near = Math.min(near, d);
        if (d < o.reach + closeM) return { ok: false, near };
        if (!sight || d >= sightM) continue;
        for (const ey of o.eyes) for (const hy of [1.2, h / 2, h + 1.2]) if (!M.losBlocked(o.x, ey, o.z, x, g + hy, z)) return { ok: false, near }; }
      return { ok: true, near }; };
    const pick = (x0, z0, h) => { const cand = [];
      for (let x = -span; x <= span; x += 10) for (let z = -span; z <= span; z += 10) if (inCircle(x, z)) cand.push([Math.hypot(x - x0, z - z0), x, z]);
      cand.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
      for (const sight of [true, false]) for (const [d, x, z] of cand) { const c = clearOf(x, z, h, sight); if (c.ok && flatOk(x, z)) return { x, z, r: Math.round(d), near: Math.round(c.near), hidden: sight }; }
      return null; };
    const out = [];
    bots.forEach((b, i) => { const h = hs[i]; const sp = pick(b.pos.x, b.pos.z, h);
      if (sp) { b.pos.x = sp.x; b.pos.z = sp.z; }
      const g = M.heightAt(b.pos.x, b.pos.z);
      taken.push({ x: b.pos.x, z: b.pos.z, eyes: [g + 1.5, g + h + 1.2], reach: reachOf(b) });
      b.hp = 100; b.shield = 0; b.pos.y = g + h; b.vel.set(0, 0, 0); b.onGround = false; if (b.obj) b.obj.position.copy(b.pos);
      out.push({ id: b.id, h, g, round: storms.length, flat: !!sp, moved: sp ? sp.r : null, nearM: sp ? sp.near : null, hidden: sp ? sp.hidden : null }); });
    const gl = new Set(), fd = new Map(), atk = new Map();
    const onF = (a, d) => { if (a && ids.has(a.id)) fd.set(a.id, (fd.get(a.id) || 0) + (+d || 0)); };
    const onH = (a, e) => { if (!a || !ids.has(a.id)) return; const by = e && e.attackerId != null ? e.attackerId : null; const dmg = e ? +e.dmg || 0 : 0;
      if (by != null) { atk.set(a.id, (atk.get(a.id) || 0) + dmg); const A = W.actorById.get(by);
        hurt.push({ t: +W.t.toFixed(2), id: a.id, dmg: +dmg.toFixed(1), by, w: e.weaponId || null, byDist: A ? +Math.hypot(A.pos.x - a.pos.x, A.pos.z - a.pos.z).toFixed(1) : null }); } };
    W.events.on('fallDamage', onF); W.events.on('actorHurt', onH);
    // over the window, every 10 frames: the nearest OTHER live actor (minSepM), the least margin to any other actor's live trigger range
    // (outOfRangeM = min(distance - its range), information: a gun looted inside the window lengthens it), and `exposed`: every sample where
    // another actor stood inside its live range of a test bot WITH a clear sight line to it (able to shoot) - any = the setup did not hold
    const minSep = new Map(), rmin = new Map(), rwho = new Map(), shoot = new Map();
    for (let f = 0; f < winF; f++) { P.step(1, 1 / 60, false);
      for (const o of out) { const b = W.actorById.get(o.id); if (!b) continue; if (b.gliding) gl.add(o.id);
        if (f % 10 === 0) { let m = 1e9, mr = 1e9, who = null; for (const a of W.actors) if (a !== b && a.alive) { const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z), ra = reachOf(a); m = Math.min(m, d);
            if (d - ra < mr) { mr = d - ra; who = { id: a.id, d: Math.round(d), reach: Math.round(ra), t: +W.t.toFixed(2), state: a.brain ? a.brain.state : null, gliding: !!a.gliding, onGround: !!a.onGround }; }
            // IN RANGE AND IN SIGHT = able to shoot this test bot this frame (its live trigger range, perceive's sight test from its eye)
            if (d < ra && !M.losBlocked(a.pos.x, a.pos.y + 1.5, a.pos.z, b.pos.x, b.pos.y + 1.2, b.pos.z)) { const l = shoot.get(o.id) || []; if (l.length < 4) l.push({ id: a.id, d: Math.round(d), reach: Math.round(ra), t: +W.t.toFixed(2) }); shoot.set(o.id, l); } }
          minSep.set(o.id, Math.min(minSep.has(o.id) ? minSep.get(o.id) : 1e9, m)); if (!rmin.has(o.id) || mr < rmin.get(o.id)) { rmin.set(o.id, mr); rwho.set(o.id, who); } } } }
    if (W.events.off) { W.events.off('fallDamage', onF); W.events.off('actorHurt', onH); }
    for (const o of out) { const b = W.actorById.get(o.id); rows.push(Object.assign(o, { hp: b.hp, alive: !!b.alive, onGround: !!b.onGround, canopy: gl.has(o.id),
      fallDmg: fd.get(o.id) || 0, atkDmg: atk.get(o.id) || 0, minSepM: Math.round(minSep.get(o.id) || 0), outOfRangeM: Math.round(rmin.has(o.id) ? rmin.get(o.id) : 0), closest: rwho.get(o.id) || null, exposed: shoot.get(o.id) || [] })); }
  }
  return { rows, hurt, storm: storms, others: W.actors.filter((a) => a.alive).length }; }"""


def part_bots(s, v, args):
    R = v.data.setdefault("bots", {})
    s.boot()
    L.dismiss_cards(s)
    R["start"] = s.start_match("quick", 77, "ashgrid", enter=True, guard=True)
    s.freeze_loop()
    s.install_pump()
    s.step_frames(30, 1 / 60)
    if args.plant:
        L.plant_js(s, PLANTS[args.plant])
    res = s.js(BOT_DROP_JS, [[[DEAD_H, 15, 10]] * 3, CLOSE_M, SIGHT_M, WIN_F])
    rows = res["rows"]
    R["drops"] = rows
    R["attackerHits"] = res["hurt"]
    R["storm"], R["others"] = res["storm"], res["others"]
    # the SAME rule as the human: 10 m and 15 m (both below the height at which a falling player can still open the canopy: > 12 m
    # above the ground while already falling fast) cost what the human's drop cost (part human, +- 4 hp for the ground under a bot);
    # 20 m: dead, OR the bot opened its canopy in the air exactly as a player may (SPACE mid-air) and took no fall damage = it avoided
    # the lethal drop (C-FALL "bots avoid lethal drops"). A bot that survives a 20 m drop WITHOUT a canopy fails.
    # R3: each drop is judged on what the window recorded: the fall damage (fallDmg, the 'fallDamage' events) must be ALL of the hp lost that
    # an attacker did not take (hp lost - attacker damage == fallDmg, +- 0.5), and the fallDmg is what must sit on the curve; a death at 22 m
    # counts only as a death BY the fall (fallDmg recorded, no attacker damage)
    hum = (v.data.get("human") or {}).get("curve") or {}
    lost = lambda r: (100 - r["hp"]) if r["alive"] else 100
    acct = [abs(lost(r) - r["atkDmg"] - r["fallDmg"]) <= 0.5 for r in rows if r["alive"] and r["h"] in (10, 15)]
    ten = [r["fallDmg"] for r in rows if r["h"] == 10 and r["alive"]]
    fif = [r["fallDmg"] for r in rows if r["h"] == 15 and r["alive"]]
    twenty = [r for r in rows if r["h"] == DEAD_H]
    h15 = hum.get("15")
    ok15 = len(fif) == 3 and (all(abs(x - h15) <= 4 for x in fif) if h15 is not None else all(x > TEN_HI for x in fif))
    ok20 = len(twenty) == 3 and all((not r["alive"] and r["fallDmg"] > 0 and r["atkDmg"] == 0) or (r["alive"] and r["canopy"] and r["fallDmg"] == 0) for r in twenty)
    ok = len(ten) == 3 and all(TEN_LO <= x <= TEN_HI for x in ten) and ok15 and ok20 and len(acct) == 6 and all(acct)
    name = "bots-rule (bots: 10 m costs %d-%d, 15 m = the human's 15 m +- 4 hp, %d m kills unless the bot opened its canopy mid-air)" % (TEN_LO, TEN_HI, DEAD_H)
    det = {"tenFallDmg": ten, "fifteenFallDmg": fif, "human15": h15, "hpLostMinusAttackers==fallDmg": acct,
           "tenLost": [lost(r) for r in rows if r["h"] == 10], "atkDmg": [round(r["atkDmg"], 1) for r in rows], "attackerHits": res["hurt"][:6],
           "flat": [r.get("flat") for r in rows], "movedM": [r.get("moved") for r in rows], "nearM": [r.get("nearM") for r in rows], "hidden": [r.get("hidden") for r in rows],
           "minSepM": [r.get("minSepM") for r in rows], "outOfRangeM": [r.get("outOfRangeM") for r in rows],
           "twenty": [{"alive": r["alive"], "canopy": r["canopy"], "fallDmg": round(r["fallDmg"], 2), "atkDmg": round(r["atkDmg"], 1)} for r in twenty]}
    held = all(not r.get("exposed") for r in rows)
    if not all(r.get("flat") for r in rows) or not held:
        v.cnj(name, "SETUP missed (R3): no flat spot out of every other actor's fire range + %d m inside the circle for %s, or another actor stood in range AND in sight of a test bot inside the window: %s: %s"
              % (CLOSE_M, [r["id"] for r in rows if not r.get("flat")], [(r["id"], r["exposed"]) for r in rows if r.get("exposed")], det))
    else:
        v.check(name, ok, det, "same rule as the human; hp lost - attacker damage == fallDmg")
    # bots avoid lethal drops: 180 s of play, count deaths whose damage came from a fall
    av = s.js("""() => { const W = window.__LC__.W, C = window.__LC__; const deaths = [], falls = [];
        W.events.on('fallDamage', (a, d) => falls.push({ id: a && a.id, bot: !!(a && a.isBot), alive: !!(a && a.alive), t: W.t }));
        W.events.on('actorDied', (a) => { if (a && a.isBot) deaths.push({ id: a.id, t: W.t }); });
        C.fastForward(180, 1 / 30);
        const fallDeaths = falls.filter((f) => f.bot && !f.alive).length;
        return { falls: falls.length, botFallDeaths: fallDeaths, botDeaths: deaths.length, t: W.t, phase: W.phase }; }""")
    R["avoid"] = av
    v.check("bots-avoid (0 bot deaths from a fall in 180 s of a quick match)", av["botFallDeaths"] == 0 and av["botDeaths"] > 0,
            av, "0 fall deaths (and the match did run: > 0 bot deaths)")


# bots-avoid's falsifier (fix round, the check's request): the 180 s quick match never offers a bot a lethal lip, so the row passed with the base
# bots.js too. This setup does: on Isla Viva's terrain lips (ground falling >= 7 m within 4 m, a flat collider-free plateau behind), a bot at
# LIP_HP hp (no shield, no heals) stands 1.2 m from the lip, DRY (no gun, no ammo: FLEE 92 is its top score while an enemy is inside 18 m), and an
# enemy bot (pinned, unarmed, guarded) stands 9 m behind it on the plateau and keeps provoking it: it runs from him, toward the drop. A drop of
# >= 7 m costs more than LIP_HP = 10 at the C-FALL curve (7 m: 17 hp on the pre-D2 curve; a 10 m drop costs 35-40 after D2), so a bot that
# walks off dies of the fall; the guard's own walk limit for a 10 hp bot is ~5 m. 25 s per lip.
LIP_MAP, LIP_SEED, LIP_HP, LIP_N, LIP_DROP = "isla_viva", 77, 10, 6, 7
LIP_FIND_JS = r"""([drop, wantN]) => { const W = window.__LC__.W, M = W.map, wy = M.waterY;
  const free = (x, z, r, h) => { for (const c of M.queryColliders(x, z, r + 1, [])) { if (c.dead) continue; if (c.maxY > h + 0.3 && c.minX < x + r && c.maxX > x - r && c.minZ < z + r && c.maxZ > z - r) return false; } return true; };
  const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null; const cc = st ? (st.nextCenter || st.center) : { x: 0, z: 0 };
  const lips = []; const span = (M.half || 800) * 0.85;
  for (let x = -span; x <= span; x += 4) for (let z = -span; z <= span; z += 4) { const h0 = M.heightAt(x, z); if (!(h0 > wy + 2)) continue;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a); let fall = 0;
      for (let d = 1; d <= 4; d += 0.5) fall = Math.max(fall, h0 - M.heightAt(x + dx * d, z + dz * d)); if (fall < drop) continue;
      let flat = true; for (let d = 1; d <= 8; d += 1) if (Math.abs(M.heightAt(x - dx * d, z - dz * d) - h0) > 1.5) { flat = false; break; } if (!flat) continue;
      const hf = M.heightAt(x + dx * 6, z + dz * 6); if (!(hf > wy + 0.5) || h0 - hf < drop) continue;
      if (!free(x - dx * 4, z - dz * 4, 4.5, h0)) continue;
      // FLEE runs 60 m from the threat blended 0.45 toward the circle centre: keep the lips whose escape heads over the drop
      const fx = (x + dx * 60) * 0.55 + cc.x * 0.45, fz = (z + dz * 60) * 0.55 + cc.z * 0.45; const ahead = (fx - x) * dx + (fz - z) * dz;
      lips.push({ x, z, dx, dz, h0: +h0.toFixed(2), foot: +hf.toFixed(2), drop: +(h0 - hf).toFixed(2), ahead: +ahead.toFixed(1) }); break; } }
  lips.sort((p, q) => q.drop - p.drop); const pick = [];
  for (const l of lips) if (pick.every((p) => Math.hypot(p.x - l.x, p.z - l.z) >= 60)) pick.push(l);
  return { n: lips.length, lips: pick.slice(0, wantN), centre: cc }; }"""
LIP_RUN_JS = r"""([lip, hp, secs]) => { const W = window.__LC__.W, C = window.__LC__, M = W.map;
  const pool = W.actors.filter((a) => a.isBot && a.alive && !a.downed && !a.gliding && !window.__P23LIPUSED__?.has(a.id));
  const [b, e] = pool.sort((q, r) => Math.hypot(q.pos.x - lip.x, q.pos.z - lip.z) - Math.hypot(r.pos.x - lip.x, r.pos.z - lip.z)).slice(0, 2);
  if (!b || !e) return { error: 'no two free bots' };
  (window.__P23LIPUSED__ = window.__P23LIPUSED__ || new Set()).add(b.id); window.__P23LIPUSED__.add(e.id);
  const put = (a, x, z) => { a.pos.set(x, M.heightAt(x, z) + 0.05, z); a.vel.set(0, 0, 0); a.onGround = true; a.gliding = false; if (a.obj) a.obj.position.copy(a.pos); };
  const strip = (a) => { const sl = a.inventory.slots; for (let i = 0; i < sl.length; i++) sl[i] = null; for (const k in a.inventory.ammo) a.inventory.ammo[k] = 0; };
  put(b, lip.x - lip.dx * 1.2, lip.z - lip.dz * 1.2); b.yaw = Math.atan2(-lip.dx, -lip.dz); b.hp = hp; b.shield = 0; strip(b);
  const ex = lip.x - lip.dx * 10.2, ez = lip.z - lip.dz * 10.2; put(e, ex, ez); strip(e); e.hp = 100; e.shield = 100;
  const fall = []; let died = null; const y0 = b.pos.y;
  const onF = (a, d) => { if (a && a.id === b.id) fall.push({ d: +(+d || 0).toFixed(1), t: +W.t.toFixed(2) }); };
  const onD = (a) => { if (a && a.id === b.id && !died) died = { t: +W.t.toFixed(2), byFall: fall.length > 0, y: +a.pos.y.toFixed(2) }; };
  W.events.on('fallDamage', onF); W.events.on('actorDied', onD);
  // SETUP ONLY, every frame: the threat pinned + unhurt; the bot under test kept provoked by him, dry and at most `hp` (never topped up)
  const upd = () => { const E = W.actorById.get(e.id); if (E && E.alive) { E.pos.set(ex, M.heightAt(ex, ez) + 0.05, ez); E.vel.set(0, 0, 0); E.hp = 100; E.shield = 100; }
    const B = W.actorById.get(b.id); if (B && B.alive && !B.downed) { B.lastAttacker = e.id; B.lastDamageT = W.t; if (B.shield > 0) B.shield = 0; if (B.hp > hp) B.hp = hp;
      if (B.inventory) for (const k in B.inventory.ammo) B.inventory.ammo[k] = 0; } };
  W.kernel._updaters.push(upd);
  const states = {}; let minY = y0, past = -9, moved = 0; const x0 = b.pos.x, z0 = b.pos.z, path = [];
  for (let i = 0; i < secs * 10 && !died; i++) { C.fastForward(0.1, 1 / 30); const B = W.actorById.get(b.id); if (!B) break;
    const st = B.brain && B.brain.state; if (st) states[st] = (states[st] || 0) + 1; minY = Math.min(minY, B.pos.y);
    past = Math.max(past, (B.pos.x - lip.x) * lip.dx + (B.pos.z - lip.z) * lip.dz); moved = Math.max(moved, Math.hypot(B.pos.x - x0, B.pos.z - z0));
    if (i % 5 === 0 || B.pos.y < y0 - 1) path.push([+B.pos.x.toFixed(1), +B.pos.y.toFixed(1), +B.pos.z.toFixed(1), st || null]); }
  const k = W.kernel._updaters.indexOf(upd); if (k >= 0) W.kernel._updaters.splice(k, 1);
  if (W.events.off) { W.events.off('fallDamage', onF); W.events.off('actorDied', onD); }
  const B = W.actorById.get(b.id);
  return { bot: b.id, threat: e.id, lip: { x: lip.x, z: lip.z, drop: lip.drop }, fall, died, alive: !!(B && B.alive), states, dropped: +(y0 - minY).toFixed(2), pastLipM: +past.toFixed(2), movedM: +moved.toFixed(2), path: path.slice(0, 24) }; }"""


def part_lip(s, v, args):
    R = v.data.setdefault("lip", {})
    if args.plant == "no-fall-guard":
        R["plant"] = L.serve_patched(s, "runtime/3d/royale/bots.js", NO_FALL_GUARD)
    s.boot()
    L.dismiss_cards(s)
    R["start"] = s.start_match("quick", LIP_SEED, LIP_MAP, enter=True, guard=True)
    s.freeze_loop()
    s.install_pump()
    s.step_frames(30, 1 / 60)
    found = s.js(LIP_FIND_JS, [LIP_DROP, LIP_N])
    R["found"] = {"n": found["n"], "centre": found["centre"], "lips": found["lips"]}
    runs = [s.js(LIP_RUN_JS, [lip, LIP_HP, 25]) for lip in found["lips"]]
    R["runs"] = runs
    # a lip is JUDGED when its bot really moved there (>= 1.5 m from where it was put) or fell; a bot that stood still tested nothing
    judged = [r for r in runs if not r.get("error") and (r.get("movedM", 0) >= 1.5 or r["fall"])]
    walked = [r for r in judged if r["died"] and r["died"]["byFall"]]
    fled = [r for r in judged if r["states"].get("FLEE", 0) >= 5]
    name = "bots-avoid lips (a dry bot at %d hp fleeing a threat toward a >= %d m terrain lip: 0 die of the fall, up to %d lips)" % (LIP_HP, LIP_DROP, LIP_N)
    det = {"fallDeaths": len(walked), "lips": len(judged), "fled": len(fled),
           "runs": [{k: r.get(k) for k in ("bot", "lip", "fall", "died", "states", "dropped", "pastLipM", "movedM", "path")} for r in runs]}
    if len(judged) < 2:
        v.cnj(name, "SETUP missed (D16): %d lips judged (want >= 2: the bot moved >= 1.5 m or fell): %s" % (len(judged), det))
    else:
        v.check(name, not walked, det, "0 fall deaths")


# plant no-fall-guard: bots.js as if the sim had no fall damage (LETHAL_H / WALK_H stay null: "nothing below changes a single step" - the base
# bots' behaviour). The sim's fall damage is untouched, so a bot that walks off a lethal lip dies of it: bots-avoid lips must FAIL
NO_FALL_GUARD = [("LETHAL_H = dropTable(() => 2);", "LETHAL_H = null;"), ("WALK_H = dropTable((hp) => Math.max(6, hp * 0.25));", "WALK_H = null;")]


def part_glide(s, v, args):
    R = v.data.setdefault("glide", {})
    s.boot()
    L.dismiss_cards(s)
    R["start"] = s.start_match("standard", 7, "isla_viva", enter=True, guard=True)
    if args.plant:
        L.plant_js(s, PLANTS[args.plant])
    g = s.js("""() => { const W = window.__LC__.W, C = window.__LC__; const ev = [], glEnd = new Map(), was = new Map();
        W.events.on('fallDamage', (a, d) => { if (a) ev.push({ id: a.id, d, t: +W.t.toFixed(2), sinceGlide: glEnd.has(a.id) ? +(W.t - glEnd.get(a.id)).toFixed(2) : null }); });
        let n = 0;
        // airborne = gliding, or off the ground and NOT swimming (a swimmer is off the ground by design: fall_all3 10-26 ended its 160 s with
        // 3 'still airborne' actors on Isla Viva)
        const air = (a) => a.alive && (a.gliding || (!a.onGround && !a.swimming));
        while (n < 1600 && W.actors.some(air)) { C.fastForward(0.1, 1 / 30); n++;
          for (const a of W.actors) { const gl = !!a.gliding; if (was.get(a.id) && !gl) glEnd.set(a.id, W.t); was.set(a.id, gl); } }
        // a touchdown that ends a glide: a fallDamage within 2 s of that actor's glide end (later ones are ordinary drops on the ground)
        const atLanding = ev.filter((e) => e.sinceGlide != null && e.sinceGlide <= 2.0);
        const stillA = W.actors.filter(air), still = stillA.length;
        const stuck = stillA.slice(0, 5).map((a) => ({ id: a.id, y: +a.pos.y.toFixed(2), ground: +W.map.heightAt(a.pos.x, a.pos.z).toFixed(2), vy: +a.vel.y.toFixed(2), gliding: !!a.gliding, swim: !!a.swimming }));
        return { eventsAtLanding: atLanding.length, sample: atLanding.slice(0, 5), laterDrops: ev.length - atLanding.length, stillAirborne: still, t: W.t,
                 glidesEnded: glEnd.size, stuck }; }""")
    R["result"] = g
    v.check("glide (the whole drop: 0 fallDamage at any glide / canopy touchdown, human and every bot)", g["eventsAtLanding"] == 0 and g["stillAirborne"] == 0 and g["glidesEnded"] >= 40,
            g, "0 events within 2 s of a glide end; everyone landed")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="human,bots,lip,glide")
    args = L.parse(ap)
    parts = set(args.parts.split(","))

    def body(v):
        with C.Session(args, "p23_fall") as s:
            v.data["setup"] = L.practice(s, 4242, "isla_viva")
            have = L.contract(s, {"K.FALL_SAFE_V": "typeof K.FALL_SAFE_V === 'number'", "K.FALL_DMG_PER_V": "typeof K.FALL_DMG_PER_V === 'number'",
                                  "K.LAND_STAGGER_S": "Math.abs(K.LAND_STAGGER_S - 0.4) < 0.051"})
            L.contract_row(v, "contract (K.FALL_SAFE_V, K.FALL_DMG_PER_V numbers; K.LAND_STAGGER_S 0.4 s)", have)
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            if "human" in parts:
                part_human(s, v, args)
            L.errors_row(v, s, "errors [human]")
        if "bots" in parts:
            with C.Session(args, "p23_fall_bots") as s:
                part_bots(s, v, args)
                L.errors_row(v, s, "errors [bots]")
        if "lip" in parts:
            with C.Session(args, "p23_fall_lip") as s:
                part_lip(s, v, args)
                L.errors_row(v, s, "errors [lip]")
        if "glide" in parts:
            with C.Session(args, "p23_fall_glide") as s:
                part_glide(s, v, args)
                L.errors_row(v, s, "errors [glide]")
    return C.run_gate("p23_fall", body, args)


if __name__ == "__main__":
    sys.exit(main())
