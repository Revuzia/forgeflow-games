#!/usr/bin/env python
"""dbno - C-DBNO / LC-15 knock-and-revive (owner OD-3: team modes duo / trio / squad ONLY, never solo / free-for-all). P3 feature split across
lanes sim (constants + capsule), player (state machine, crawl, revive channel), bots (finish / ignore / revive), net (flag bit + 'revive'),
hud (BLEEDING OUT, [HOLD E] Revive), loot (downed gate). The gate reads only the contract surface (README "Parity waves P2 + P3").

    python _harness/p23/dbno.py --disk                              # all parts
    python _harness/p23/dbno.py --disk --parts solo,bot             # one page only (no squad relay)
    python _harness/p23/dbno.py --rev 9aa2b746                      # control: the P2 base (no DBNO) - MUST FAIL
    python _harness/p23/dbno.py --disk --plant crawl-fast           # K.DBNO_CRAWL = 4 - MUST FAIL (crawl row)
    python _harness/p23/dbno.py --disk --plant no-bleed             # K.DBNO_BLEED_HPS = 0 - MUST FAIL (bleed / bleed-out rows)
    python _harness/p23/dbno.py --disk --plant revive-quick         # K.REVIVE_S = 1 - MUST FAIL (5 s channel row)
    python _harness/p23/dbno.py --disk --parts bot --plant no-commit   # bots.js served with the revive commitment off - MUST FAIL (dither)
    python _harness/p23/dbno.py --disk --parts bot --plant no-revive-threat   # bots.js: no revive while an enemy was seen in 10 s - MUST FAIL (revive-start)
    python _harness/p23/dbno.py --lanes all                         # validation: every lane's work served over the base
    python _harness/p23/dbno.py --disk --parts human2 --control h2-short-hold  # E released after 3 s of GAME time - MUST FAIL (human2 revive row)

Part SOLO (STANDARD, solo, Savanna seed 7): W.match.mode 'solo', every actor its own team; a lethal hit on the human kills it (never downed);
  120 s of the match through fastForward: 0 'actorDowned' events (solo play unchanged).
Part BOT (STANDARD, duo, Savanna seed 7): the human and its bot teammate are moved to an isolated flat spot (>= 150 m from every other actor),
  loop frozen, frames stepped at 60 Hz, REAL keys:
  teams        W.match.mode 'duo'; the human's teamId is shared by exactly one bot
  knock        a lethal hit from an enemy: alive, downed, downedHp 100, knocks 1, ONE 'actorDowned'
  capsule      K.actorHeight(downed) = 0.6 +- 0.05 m
  crawl        W held 2 s: median speed over the last second 1.4 +- 0.15 m/s (K.DBNO_CRAWL)
  no-shoot     LMB held 1 s while downed: 0 shots; a medkit in slot 4: Digit4 + LMB -> no 'healStart'
  hurt-pool    a 20 hp hit on the downed human lowers downedHp by 20 (+-1) and it stays alive
  bleed        5 s of frames: downedHp falls K.DBNO_BLEED_HPS x 5 (+-15 %)
  hud-bleed    'BLEEDING OUT' is on screen (inside the vitals anchor)
  bot-revive   the bot teammate (teleported 12 m away) revives the human within 25 s: 'actorRevived'(human, mate), hp 30
  human-revive the mate knocked; the human 1.2 m from it: real E held 3 s and released -> 'reviveCancel', still downed; E held again ->
               'actorRevived'(mate, human) after 5.0 +- 0.15 s of channel (K.REVIVE_S), mate hp 30; the [HOLD E] Revive prompt was shown
  bleed-out    the human's 2nd knock, the mate held 100 m away: it dies within 100 / K.DBNO_BLEED_HPS s, and drains faster than knock 1
  team-elim    a TRIO match (seed 11): two members knocked stay downed while the third is up; the third knocked -> all three die
  (W9 R1B, "a bot mate dithers between fighting and reviving while you bleed out"; a fresh DUO match, Savanna seed 7, frames stepped at 60 Hz)
  The human is knocked 15 m from its (armed, guarded) bot mate; an enemy bot (unarmed, guarded, pinned) PEEKS at the mate: 2 s on a spot in the
  open, 2 s out of sight (moved 350 m off), over and over. DITHER_N episodes per threat range (a first knock each: knocks reset - setup), each
  until the revive completes or DITHER_CAP_S (then a setup rescue: the mate is put 1 m from the human, the enemy hidden, so the next episode
  starts from an up human; a mate that has not revived it 1 s before its bleed-out leaves the rescue to the game's own revive entry).
  dither       threat at 30 m: REVIVE <-> ENGAGE flips of the mate per downed-human episode: median <= 2 and max <= 4 (design pick: the brief
               has no number; label: W9 G design)
  revive-start threat at 50 m (> 45 m): the mate starts the revive channel before the human bleeds out in >= 80 % of the episodes
  --plant no-commit: bots.js served with the revive commitment / hysteresis off (REVIVE_COMMIT = false) - MUST FAIL dither
  --plant no-revive-threat: bots.js served with REVIVE scored 0 while an enemy was seen in the last 10 s (the mate that will not revive with a
               threat about, however far) - MUST FAIL revive-start (no-commit cannot: past 45 m the pre-W9 rule already revived)
Part HUMAN2 (two pages, the squad relay stand-in of squadguard_live, a REAL duo match on both): the guest is knocked on its own page; the host
  sees the guest's body downed within 1 s; the guest crawls (real W) and the host sees it move; the host (teleported 1.2 m away) holds real E
  until its sim completes the revive (cap 5 s / host sim rate + 1.5 s real) and the channel took 5.0 +- 0.25 s of the host's GAME time;
  the guest ends revived on 30 hp on its page and up on the host's; the per-tick 'state' message is the same size downed as up (+-4 B).
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

C_REVIVE_S = 5.0      # R3: C-DBNO "a revive takes 5 s" - the human2 channel row's fixed bar (+- 0.25 s)
PLANTS = {
    "crawl-fast": "K.DBNO_CRAWL = 4; if (K.DBNO) K.DBNO.CRAWL = 4",
    "no-bleed": "K.DBNO_BLEED_HPS = 0; if (K.DBNO) K.DBNO.BLEED_HPS = 0; if (typeof K.dbnoBleedRate === 'function') K.dbnoBleedRate = () => 0",
    "revive-quick": "K.REVIVE_S = 1; if (K.DBNO) K.DBNO.REVIVE_S = 1",
    # (W9 R1B) bots.js served with REVIVE_COMMIT = false (NO_COMMIT below): no page snippet
    "no-commit": "",
    # (W9 R1B) bots.js served with NO_REVIVE_THREAT below: no page snippet
    "no-revive-threat": "",
}
NO_COMMIT = [("const REVIVE_COMMIT = true;", "const REVIVE_COMMIT = false;")]
NO_REVIVE_THREAT = [("      if (md > REVIVE_SEEK_M) s.REVIVE = 0;", "      if (md > REVIVE_SEEK_M || W.t - bb.targetSeenT < 10) s.REVIVE = 0;")]
DITHER_N, DITHER_CAP_S, DITHER_MATE_M, DITHER_PEEK_S = 4, 52, 15, 2.0
DITHER_MED_MAX, DITHER_MAX_MAX, REVSTART_MIN = 2, 4, 80.0
# one episode: knock the human, the enemy peeks at the mate (2 s seen / 2 s hidden), every frame the mate's state; the episode ends at the revive,
# the human's death, or capS (then the setup rescue). Returns the flip count (REVIVE <-> ENGAGE between consecutive REVIVE / ENGAGE states).
DITHER_JS = r"""([me, mate, foe, cx, cz, threatM, capS, peekS, mateM]) => {
  const W = window.__LC__.W, M = W.map, P = window.__H_PUMP__, Q = window.__P23D__, K = W.SIM, H = (M.half || 760) - 40;
  const cl = (v) => Math.max(-H, Math.min(H, v));
  const at = (x, z) => [cl(x), M.heightAt(cl(x), cl(z)) + 0.05, cl(z)];
  const put = (a, q) => { a.pos.set(q[0], q[1], q[2]); a.vel.set(0, 0, 0); a.onGround = true; a.gliding = false; if (a.obj) a.obj.position.copy(a.pos); };
  const A = W.actorById.get(me), B = W.actorById.get(mate), E = W.actorById.get(foe);
  if (!A || !B || !E || !A.alive || !B.alive || !E.alive || A.downed) return { error: 'actors', alive: [!!(A && A.alive), !!(B && B.alive), !!(E && E.alive)], downed: !!(A && A.downed) };
  // SETUP: the mate armed (an AR + 120 rounds when it carries no loaded gun); the enemy unarmed (it never shoots back: the mate is never hurt)
  const sl = B.inventory.slots;
  const loaded = sl.some((s2) => s2 && s2.kind === 'weapon' && K.WEAPONS[s2.id] && (s2.mag > 0 || (B.inventory.ammo[K.WEAPONS[s2.id].ammo] || 0) > 0));
  if (!loaded) { sl[0] = { kind: 'weapon', id: 'ar', rarity: 1, mag: K.WEAPONS.ar.mag }; B.inventory.ammo.medium = 120; B.inventory.active = 0; }
  const es = E.inventory.slots; for (let i = 0; i < es.length; i++) es[i] = null; for (const k in E.inventory.ammo) E.inventory.ammo[k] = 0;
  // the human at (cx, cz), the mate mateM m west of it; the enemy's open spot threatM from the mate, north or south (whichever the mate's eye sees)
  const hm = at(cx, cz), bm = at(cx - mateM, cz);
  let vis = null;
  // north or south first; then (W9 R1B) west (away from the human), the four diagonals, east: a plant that changes the earlier parts' outcomes
  // moves the isolated spot, and north / south alone found no open line at 50 m there (could-not-judge instead of the control's FAIL)
  for (const [ux, uz] of [[0, 1], [0, -1], [-1, 0], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, 0.7071], [0.7071, -0.7071], [1, 0]]) {
    const q = at(bm[0] + ux * threatM, bm[2] + uz * threatM); if (!M.losBlocked(bm[0], bm[1] + 1.5, bm[2], q[0], q[1] + 1.2, q[2])) { vis = q; break; } }
  if (!vis) return { error: 'no open peek spot', threatM };
  const hid = at(bm[0], bm[2] + (vis[2] > bm[2] ? -350 : 350));
  put(A, hm); put(B, bm); put(E, vis);
  if (B.brain) { B.brain.bb.target = null; B.brain.state = 'WANDER'; B.brain.nextThink = 0; }
  P.step(2, 1 / 60, false);
  // the knock: a first knock every episode (knocks reset - setup), 250 from the enemy
  A.knocks = 0; A.hp = 100; A.shield = 0; W.hurtActor(A, 250, foe, 'ar', false);
  P.step(1, 1 / 60, false);
  if (!A.downed) return { error: 'not downed', alive: !!A.alive };
  // (W9 R1B) SETUP FENCE: every other actor is kept FENCE_M from the spot, every frame (a 52 s episode let third parties walk in: 'otherTarget'
  // in the hundreds, and under the no-revive-threat plant a passer-by killed the downed human, which ended the run's setup - could-not-judge)
  const FENCE_M = 200, fence = () => { for (const o of W.actors) { if (o === A || o === B || o === E || !o.alive || o.gliding) continue;
    const dx = o.pos.x - cx, dz = o.pos.z - cz, d = Math.hypot(dx, dz); if (d < FENCE_M) { const k = (FENCE_M + 5) / Math.max(0.1, d); put(o, at(cx + dx * k, cz + dz * k)); } } };
  fence();
  const from = Q.ev.length, t0 = W.t;
  let flips = 0, last = null, revStart = null, revived = null, died = null, seenN = 0, otherTarget = 0, minFoeD = 1e9; const states = [];
  for (let f = 0; f < capS * 60; f++) {
    const shown = Math.floor((W.t - t0) / peekS) % 2 === 0;
    put(E, shown ? vis : hid); E.hp = 100; E.shield = 100; fence();
    P.step(1, 1 / 60, false);
    const st = B.brain ? B.brain.state : null;
    if (st === 'REVIVE' || st === 'ENGAGE') { if (last && st !== last) flips++; last = st; }
    if (!states.length || states[states.length - 1][1] !== st) states.push([+(W.t - t0).toFixed(2), st]);
    if (B.brain && B.brain.bb.target === foe && W.t - B.brain.bb.targetSeenT < 0.05) seenN++;
    if (B.brain && B.brain.bb.target && B.brain.bb.target !== foe) otherTarget++;
    if (shown) minFoeD = Math.min(minFoeD, Math.hypot(E.pos.x - B.pos.x, E.pos.z - B.pos.z));
    for (const e of Q.ev.slice(from)) {
      if (e.n === 'reviveStart' && e.a === mate && e.b === me && revStart == null) revStart = +(e.t - t0).toFixed(2);
      if (e.n === 'actorRevived' && e.a === me && revived == null) revived = +(e.t - t0).toFixed(2);
      if (e.n === 'actorDied' && e.a === me && died == null) died = +(e.t - t0).toFixed(2);
    }
    if (revived != null || died != null || !A.alive) break;
  }
  const bleedLeftS = A.downed ? +(A.downedHp / (K.dbnoBleedRate ? K.dbnoBleedRate(A.knocks || 1) : 1)).toFixed(1) : null;
  // SETUP RESCUE (not measured): the human still down at capS -> the mate is put 1 m from it and the enemy hidden, so the next episode starts up
  let rescued = null;
  if (revived == null && died == null && A.alive && A.downed) {
    put(B, at(A.pos.x - 1, A.pos.z)); put(E, hid);
    const r0 = Q.ev.length;
    // (W9 R1B) up to 15 s, but never into the bleed-out (a mate that will not revive - the no-revive-threat plant - bled the human out here
    // and every later episode lost its setup: could-not-judge, not the FAIL the control is for); still down -> the game's own revive entry
    const rate0 = K.dbnoBleedRate ? K.dbnoBleedRate(A.knocks || 1) : 0, capF = rate0 > 0 ? Math.min(15 * 60, Math.max(0, Math.floor((A.downedHp / rate0 - 1) * 60))) : 15 * 60;
    for (let f = 0; f < capF; f++) { put(E, hid); E.hp = 100; fence(); P.step(1, 1 / 60, false);
      if (Q.ev.slice(r0).some((e) => e.n === 'actorRevived' && e.a === me) || !A.alive) break; }
    let byHarness = false;
    if (A.alive && A.downed) { byHarness = true; if (typeof W.reviveActor === 'function') W.reviveActor(A, B); else { A.downed = false; A.downedHp = 0; A.hp = K.REVIVE_HP; W.events.emit('actorRevived', A, B); } P.step(1, 1 / 60, false); }
    rescued = { up: !!(A.alive && !A.downed), byHarness };
  }
  put(E, hid);
  return { threatM, flips, revStart, revived, died, bleedLeftS, rescued, seenN, otherTarget, minFoeD: +minFoeD.toFixed(1), vis: vis.map((v) => +v.toFixed(1)),
           states: states.slice(0, 40), mateState: B.brain ? B.brain.state : null, humanUp: !!(A.alive && !A.downed) }; }"""

CONTRACT = {
    "K.DBNO_CRAWL": "typeof K.DBNO_CRAWL === 'number'",
    "K.DBNO_BLEED_HPS": "typeof K.DBNO_BLEED_HPS === 'number'",
    "K.REVIVE_S": "typeof K.REVIVE_S === 'number'",
    # integrator D3 (fix round): sim's K is the single source of the DBNO tunables - these names are canonical
    "K.DBNO_HP": "typeof K.DBNO_HP === 'number'",
    "K.DBNO_KNOCK_MULT": "typeof K.DBNO_KNOCK_MULT === 'number'",
    "K.REVIVE_HP": "typeof K.REVIVE_HP === 'number'",
    "K.REVIVE_RANGE": "Math.abs(K.REVIVE_RANGE - 2.0) < 1e-9",
    "K.actorHeight": "typeof K.actorHeight === 'function'",
    "K.TEAM_SIZE": "!!K.TEAM_SIZE && K.TEAM_SIZE.duo === 2 && K.TEAM_SIZE.trio === 3",
}

EV_JS = r"""() => { const W = window.__LC__.W; if (window.__P23D__) return 'already'; const Q = window.__P23D__ = { ev: [] };
  for (const n of ['actorDowned', 'reviveStart', 'reviveCancel', 'actorRevived', 'actorDied', 'teamEliminated', 'shotFired', 'healStart'])
    W.events.on(n, function (a, b) { Q.ev.push({ n, t: +W.t.toFixed(3), a: a && a.id != null ? a.id : (typeof a === 'string' ? a : null), b: b && b.id != null ? b.id : (typeof b === 'string' ? b : null) }); });
  return 'ok'; }"""
ACT_JS = r"""(id) => { const W = window.__LC__.W, a = W.actorById.get(id); if (!a) return null; const K = W.SIM;
  return { id: a.id, alive: !!a.alive, downed: !!a.downed, downedHp: a.downedHp, knocks: a.knocks || 0, hp: a.hp, shield: a.shield, teamId: a.teamId,
           h: typeof K.actorHeight === 'function' ? +K.actorHeight(a).toFixed(3) : null, pos: [+a.pos.x.toFixed(3), +a.pos.y.toFixed(3), +a.pos.z.toFixed(3)], t: +W.t.toFixed(3) }; }"""
ISO_JS = r"""() => { const W = window.__LC__.W, M = W.map, p = W.player;
  const others = W.actors.filter((a) => a.alive && a.teamId !== p.teamId);
  const flat = (x, z) => { const h = M.heightAt(x, z); if (h < M.waterY + 1) return false;
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [12, 0], [0, 12], [-12, 0], [0, -12], [100, 0], [-100, 0]]) if (Math.abs(M.heightAt(x + dx, z + dz) - h) > (Math.abs(dx) > 50 ? 30 : 0.5)) return false;
    for (const c of M.queryColliders(x, z, 16, [])) { if (!c.dead && c.maxY > h + 0.2 && c.minX < x + 15 && c.maxX > x - 15 && c.minZ < z + 15 && c.maxZ > z - 15) return false; }
    return true; };
  const st = W.stormCtl && W.stormCtl.storm ? W.stormCtl.storm : null;
  let best = null;
  for (let k = 0; k < 3000; k++) { const x = (Math.random() * 2 - 1) * (M.half - 60), z = (Math.random() * 2 - 1) * (M.half - 60);
    const d = others.reduce((m, a) => Math.min(m, Math.hypot(a.pos.x - x, a.pos.z - z)), 1e9);
    if (d < 150 || !flat(x, z)) continue; if (Math.hypot(x, z) > M.half * 0.7) continue;
    if (!best || d > best.d) best = { x, z, d: +d.toFixed(1), y: M.heightAt(x, z) }; if (best.d > 260) break; }
  return best; }"""


def ev(s, since=0):
    return s.js("(n) => window.__P23D__.ev.slice(n)", since)


def nev(s):
    return s.js("() => window.__P23D__.ev.length")


def place(s, aid, x, z, yaw=None):
    s.js("([id, x, z, yaw]) => { const W = window.__LC__.W, a = W.actorById.get(id); a.pos.set(x, W.map.heightAt(x, z), z); a.vel.set(0, 0, 0); a.onGround = true; a.gliding = false;"
         " if (a.obj) a.obj.position.copy(a.pos); if (yaw != null && a.input) { a.input.yaw = yaw; } }", [aid, x, z, yaw])


def enemy_id(s):
    return s.js("() => { const W = window.__LC__.W, p = W.player; const e = W.actors.find((a) => a.isBot && a.alive && a.teamId !== p.teamId); return e && e.id; }")


def knock(s, aid, src):
    return s.js("([id, src]) => { const W = window.__LC__.W, a = W.actorById.get(id); a.hp = 100; a.shield = 0; W.hurtActor(a, 250, src, 'ar', false); return true; }", [aid, src])


def part_solo(args, v):
    with C.Session(args, "p23_dbno_solo") as s:
        s.boot()
        L.dismiss_cards(s)
        st = L.start(s, "standard", 7, "ashgrid", team="solo", guard=True)
        v.data["solo_start"] = st
        s.land(140, protect=True)
        s.js(EV_JS)
        m = st.get("match") or {}
        teams = s.js("() => { const W = window.__LC__.W; const ids = W.actors.map((a) => a.teamId); return { n: ids.length, distinct: new Set(ids).size, nulls: ids.filter((x) => x == null).length }; }")
        v.check("solo: W.match.mode 'solo', every actor its own team", m.get("mode") == "solo" and teams["distinct"] == teams["n"], {"match": m, "teams": teams}, "solo, distinct")
        s.guard_player(False)
        src = enemy_id(s)
        knock(s, s.js("() => window.__LC__.W.player.id"), src)
        s.step_frames(2, 1 / 60)
        me = s.js(ACT_JS, s.js("() => window.__LC__.W.player.id"))
        v.check("solo: a lethal hit kills the human (no knock)", not me["alive"] and not me["downed"], me, "dead, never downed")
        ff = s.js("() => { const C = window.__LC__; C.fastForward(120, 1 / 30); return window.__P23D__.ev.filter((e) => e.n === 'actorDowned').length; }")
        v.check("solo: 0 'actorDowned' in 120 s of the match", ff == 0, {"downedEvents": ff}, "0")
        L.errors_row(v, s, "errors [solo]")


def part_bot(args, v):
    with C.Session(args, "p23_dbno_bot") as s:
        if args.plant == "no-commit":
            v.data["plant_served"] = L.serve_patched(s, "runtime/3d/royale/bots.js", NO_COMMIT)
        elif args.plant == "no-revive-threat":
            v.data["plant_served"] = L.serve_patched(s, "runtime/3d/royale/bots.js", NO_REVIVE_THREAT)
        s.boot()
        L.dismiss_cards(s)
        st = L.start(s, "standard", 7, "ashgrid", team="duo", guard=True)
        v.data["bot_start"] = st
        have = L.contract(s, CONTRACT)
        L.contract_row(v, "contract (K.DBNO_CRAWL, K.DBNO_BLEED_HPS, K.REVIVE_S, K.DBNO_HP, K.DBNO_KNOCK_MULT, K.REVIVE_HP, K.REVIVE_RANGE 2.0 (D3), K.actorHeight, K.TEAM_SIZE)", have)
        s.land(140, protect=True)
        s.freeze_loop()
        s.install_pump()
        s.js(EV_JS)
        if args.plant:
            L.plant_js(s, PLANTS[args.plant])
        info = s.js("() => { const W = window.__LC__.W, p = W.player; const mates = W.actors.filter((a) => a !== p && a.teamId != null && a.teamId === p.teamId);"
                    " return { mode: W.match && W.match.mode, team: p.teamId, mates: mates.map((a) => ({ id: a.id, bot: !!a.isBot, alive: !!a.alive })) }; }")
        v.data["teams"] = info
        ok_team = info["mode"] == "duo" and len(info["mates"]) == 1 and info["mates"][0]["bot"]
        v.check("teams (W.match.mode 'duo'; one bot shares the human's teamId)", ok_team, info, "duo, 1 bot mate")
        if not ok_team or not info["mates"][0]["alive"]:
            L.errors_row(v, s, "errors [bot]")
            return
        me, mate = s.js("() => window.__LC__.W.player.id"), info["mates"][0]["id"]
        iso = s.js(ISO_JS)
        v.data["iso"] = iso
        if not iso:
            v.cnj("knock", "no isolated flat spot >= 150 m from every enemy")
            return
        s.guard_player(False)
        L.guard_ids(s, [mate])
        place(s, me, iso["x"], iso["z"], 0.0)
        place(s, mate, iso["x"] + 40, iso["z"])
        L.pin_actor(s, mate, [iso["x"] + 40, iso["y"], iso["z"]])
        s.step_frames(10, 1 / 60)
        src = enemy_id(s)
        n0 = nev(s)
        knock(s, me, src)
        s.step_frames(1, 1 / 60)
        a = s.js(ACT_JS, me)
        dn = [e for e in ev(s, n0) if e["n"] == "actorDowned"]
        v.check("knock (lethal hit in duo: alive, downed, downedHp 100, knocks 1, one 'actorDowned')",
                a["alive"] and a["downed"] and abs((a["downedHp"] or 0) - 100) <= 1.0 and a["knocks"] == 1 and len(dn) == 1, {"actor": a, "events": dn}, "downed on 100")
        if not a["downed"]:
            L.errors_row(v, s, "errors [bot]")
            return
        v.check("capsule (K.actorHeight of a downed actor 0.6 +- 0.05 m)", a["h"] is not None and abs(a["h"] - 0.6) <= 0.05, {"h": a["h"]}, "0.6 m")
        # crawl, real W
        L.lock_pointer(s)
        s.page.keyboard.down("KeyW")
        tr = s.js("""() => { const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__; const r = []; for (let i = 0; i < 120; i++) { P.step(1, 1 / 60, false); r.push([W.t, p.pos.x, p.pos.z]); } return r; }""")
        s.page.keyboard.up("KeyW")
        sp = [((tr[i][1] - tr[i - 1][1]) ** 2 + (tr[i][2] - tr[i - 1][2]) ** 2) ** 0.5 / max(1e-6, tr[i][0] - tr[i - 1][0]) for i in range(61, len(tr))]
        crawl = round(statistics.median(sp), 3) if sp else None
        v.check("crawl (W held: median speed over the last second 1.4 +- 0.15 m/s)", crawl is not None and abs(crawl - 1.4) <= 0.15, {"medianMps": crawl}, "1.25-1.55")
        # no shooting, no healing
        n1 = nev(s)
        s.page.mouse.down(button="left")
        s.step_frames(60, 1 / 60)
        s.page.mouse.up(button="left")
        s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[3] = { kind: 'consumable', id: 'medkit', count: 2 }; }")
        s.press("Digit4")
        s.step_frames(30, 1 / 60)
        s.page.mouse.down(button="left")
        s.step_frames(30, 1 / 60)
        s.page.mouse.up(button="left")
        bad = [e for e in ev(s, n1) if e["n"] in ("shotFired", "healStart") and e["a"] == me]
        v.check("no-shoot (downed: LMB 1 s = 0 shots; Digit4 + LMB on a medkit = no heal)", not bad, {"events": bad}, "0")
        b = s.js(ACT_JS, me)
        s.js("([id, src]) => { const W = window.__LC__.W; W.hurtActor(W.actorById.get(id), 20, src, 'pistol', false); }", [me, src])
        c = s.js(ACT_JS, me)
        dlt = None if b["downedHp"] is None or c["downedHp"] is None else round(b["downedHp"] - c["downedHp"], 2)
        v.check("hurt-pool (a 20 hp hit lowers downedHp by 20 +- 1, still alive)", c["alive"] and c["downed"] and dlt is not None and abs(dlt - 20) <= 1.0, {"before": b["downedHp"], "after": c["downedHp"]}, "-20")
        s.step_frames(300, 1 / 60)
        d = s.js(ACT_JS, me)
        rate = s.js("() => window.__LC__.W.SIM.DBNO_BLEED_HPS")
        drop = None if c["downedHp"] is None or d["downedHp"] is None else round(c["downedHp"] - d["downedHp"], 3)
        want = (rate or 0) * (d["t"] - c["t"])
        v.check("bleed (5 s: downedHp falls K.DBNO_BLEED_HPS x 5 +- 15 %)", drop is not None and want > 0 and abs(drop - want) <= 0.15 * want, {"drop": drop, "expect": round(want, 3), "rate": rate}, "+- 15 %")
        s.step_frames(2, 1 / 60, render=True)
        txt = s.js("() => document.body.innerText")
        v.check("hud-bleed ('BLEEDING OUT' on screen while downed)", "BLEEDING OUT" in txt, {"found": "BLEEDING OUT" in txt}, "shown")
        s.screenshot(os.path.join(C.REPORTS, "p23_shots", "dbno_bleed.png"))
        # the bot teammate revives
        L.pin_actor(s, mate, None)
        place(s, mate, iso["x"] + 12, iso["z"])
        n2 = nev(s)
        t0 = s.js("() => window.__LC__.W.t")
        got = s.js("""([me, mate, t0]) => { const W = window.__LC__.W, P = window.__H_PUMP__, Q = window.__P23D__;
            const from = Q.ev.length; for (let i = 0; i < 25 * 60; i++) { P.step(1, 1 / 60, false); if (Q.ev.slice(from).some((e) => e.n === 'actorRevived' && e.a === me)) break;
              const a = W.actorById.get(me); if (!a.alive) break; } return +(W.t - t0).toFixed(2); }""", [me, mate, t0])
        e = s.js(ACT_JS, me)
        rv = [x for x in ev(s, n2) if x["n"] == "actorRevived" and x["a"] == me]
        v.check("bot-revive (the bot teammate revives the human within 25 s, hp 30)", bool(rv) and rv[0]["b"] == mate and e["alive"] and not e["downed"] and abs(e["hp"] - 30) <= 1,
                {"afterS": got, "events": rv, "actor": {k: e[k] for k in ("alive", "downed", "hp")}}, "revived by the mate, hp 30")
        # the human revives the bot
        s.guard_player(True)
        L.guard_ids(s, [])
        s.step_frames(5, 1 / 60)
        mp = s.js(ACT_JS, mate)
        place(s, mate, iso["x"] + 3, iso["z"])
        L.pin_actor(s, mate, [iso["x"] + 3, iso["y"], iso["z"]])
        s.step_frames(2, 1 / 60)
        knock(s, mate, src)
        s.step_frames(2, 1 / 60)
        place(s, me, iso["x"] + 1.8, iso["z"], 0.0)
        s.step_frames(2, 1 / 60)
        n3 = nev(s)
        s.page.keyboard.down("KeyE")
        s.step_frames(5, 1 / 60, render=True)
        prompt = s.js("() => /Revive/i.test(document.body.innerText)")
        s.step_frames(175, 1 / 60)
        s.page.keyboard.up("KeyE")
        s.step_frames(5, 1 / 60)
        part = [x for x in ev(s, n3)]
        m1 = s.js(ACT_JS, mate)
        n4 = nev(s)
        s.page.keyboard.down("KeyE")
        s.step_frames(int(5.6 * 60), 1 / 60)
        s.page.keyboard.up("KeyE")
        full = ev(s, n4)
        m2 = s.js(ACT_JS, mate)
        st_ = next((x for x in full if x["n"] == "reviveStart" and x["a"] == me), None)
        dn_ = next((x for x in full if x["n"] == "actorRevived" and x["a"] == mate), None)
        chan = round(dn_["t"] - st_["t"], 3) if st_ and dn_ else None
        rs = s.js("() => window.__LC__.W.SIM.REVIVE_S")
        v.check("human-revive (E 3 s + release = cancel, still downed; E again = revived after 5.0 +- 0.15 s, hp 30; prompt shown)",
                any(x["n"] == "reviveCancel" for x in part) and m1["downed"] and m1["alive"] and chan is not None and abs(chan - 5.0) <= 0.15
                and m2["alive"] and not m2["downed"] and abs(m2["hp"] - 30) <= 1 and prompt,
                {"firstHold": [x["n"] + ("" if x.get("a") == me else "@%s" % x.get("a")) for x in part if x["n"] != "shotFired"], "afterCancel": {k: m1[k] for k in ("alive", "downed")}, "channelS": chan, "K.REVIVE_S": rs,
                 "after": {k: m2[k] for k in ("alive", "downed", "hp")}, "prompt": prompt}, "cancel, then 5.0 s, hp 30")
        # bleed-out: the HUMAN's second knock, the mate held 100 m away (nobody can revive)
        s.guard_player(False)
        L.guard_ids(s, [mate])
        place(s, me, iso["x"], iso["z"], 0.0)
        L.pin_actor(s, mate, [iso["x"] + 100, s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z)", [iso["x"] + 100, iso["z"]]), iso["z"]])
        s.step_frames(3, 1 / 60)
        knock(s, me, src)
        s.step_frames(1, 1 / 60)
        k2 = s.js(ACT_JS, me)
        died = s.js("""([id, maxS]) => { const W = window.__LC__.W, P = window.__H_PUMP__; const t0 = W.t; let h1 = null;
            for (let i = 0; i < maxS * 60; i++) { P.step(1, 1 / 60, false); const a = W.actorById.get(id); if (i === 300) h1 = a.downedHp; if (!a.alive) return { s: +(W.t - t0).toFixed(2), rate5: h1 == null ? null : +((100 - h1) / 5).toFixed(3) }; }
            const a = W.actorById.get(id); return { s: null, rate5: h1 == null ? null : +((100 - h1) / 5).toFixed(3), downedHp: a.downedHp }; }""", [me, 75])
        lim = 100.0 / rate if rate else None
        v.check("bleed-out (the human's 2nd knock, nobody near: dies within 100 / K.DBNO_BLEED_HPS s, drains faster than knock 1)",
                k2["knocks"] == 2 and k2["downed"] and died["s"] is not None and lim is not None and died["s"] <= lim + 1 and (died["rate5"] or 0) > (rate or 0) * 1.05,
                {"knocks": k2["knocks"], "diedAfterS": died["s"], "limitS": lim and round(lim, 1), "knock2RatePerS": died["rate5"], "knock1Rate": rate}, "dies, faster")
        L.pin_actor(s, None)
        L.guard_ids(s, [])
        L.errors_row(v, s, "errors [bot]")
        # TEAM ELIMINATION in a TRIO (a fresh match in the same page): the squad is out only when EVERY member is downed or dead
        s.thaw_loop()
        st3 = L.start(s, "standard", 11, "ashgrid", team="trio", guard=True)
        v.data["trio_start"] = st3
        s.land(140, protect=True)
        s.freeze_loop()
        s.install_pump()
        s.js("() => { window.__P23D__ = null; }")
        s.js(EV_JS)
        t3 = s.js("() => { const W = window.__LC__.W, p = W.player; return { mode: W.match && W.match.mode, ids: [p.id].concat(W.actors.filter((a) => a !== p && a.teamId != null && a.teamId === p.teamId).map((a) => a.id)) }; }")
        if t3["mode"] != "trio" or len(t3["ids"]) != 3:
            v.check("team-elim (trio: two knocked stay downed while one is up; the third knocked -> all three die)", False, t3, "trio of 3")
            return
        iso = s.js(ISO_JS) or {"x": 0, "z": 0}
        s.guard_player(False)
        for i, aid in enumerate(t3["ids"]):
            place(s, aid, iso["x"] + 3 * i, iso["z"])
            L.pin_actor(s, aid, [iso["x"] + 3 * i, s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z)", [iso["x"] + 3 * i, iso["z"]]), iso["z"]])
        src = enemy_id(s)
        knock(s, t3["ids"][0], src)
        s.step_frames(2, 1 / 60)
        knock(s, t3["ids"][1], src)
        s.step_frames(2, 1 / 60)
        mid = [s.js(ACT_JS, aid) for aid in t3["ids"]]
        knock(s, t3["ids"][2], src)
        s.step_frames(2, 1 / 60)
        end = [s.js(ACT_JS, aid) for aid in t3["ids"]]
        ok = (mid[0]["alive"] and mid[0]["downed"] and mid[1]["alive"] and mid[1]["downed"] and mid[2]["alive"] and not mid[2]["downed"]
              and not any(a["alive"] for a in end))
        v.check("team-elim (trio: two knocked stay downed while one is up; the third knocked -> all three die)", ok,
                {"afterTwo": [{k: a[k] for k in ("id", "alive", "downed")} for a in mid], "afterThree": [{k: a[k] for k in ("id", "alive", "downed")} for a in end]},
                "downed, downed, up -> all dead")
        L.pin_actor(s, None)
        L.errors_row(v, s, "errors [trio]")
        part_dither(s, v)


def part_dither(s, v):
    """(W9 R1B) the bot mate that dithered between fighting and reviving: a fresh DUO match in the bot part's page (see the docstring)."""
    s.thaw_loop()
    st = L.start(s, "standard", 7, "ashgrid", team="duo", guard=True)
    v.data["dither_start"] = st
    s.land(140, protect=True)
    s.freeze_loop()
    s.install_pump()
    s.js("() => { window.__P23D__ = null; }")
    s.js(EV_JS)
    info = s.js("() => { const W = window.__LC__.W, p = W.player; const m = W.actors.find((a) => a !== p && a.teamId != null && a.teamId === p.teamId);"
                " const e = W.actors.find((a) => a.isBot && a.alive && a.teamId !== p.teamId); return { mode: W.match && W.match.mode, me: p.id, mate: m && m.alive ? m.id : null, foe: e && e.id }; }")
    v.data["dither_ids"] = info
    name_d = "dither (threat peeking at 30 m, 2 s seen / 2 s hidden: REVIVE <-> ENGAGE flips per downed episode median <= %d, max <= %d; W9 design pick)" % (DITHER_MED_MAX, DITHER_MAX_MAX)
    name_r = "revive-start (threat peeking at 50 m, > 45 m: the mate starts the revive before the human bleeds out in >= %.0f %% of episodes)" % REVSTART_MIN
    if info["mode"] != "duo" or not info["mate"] or not info["foe"]:
        v.cnj(name_d, "SETUP: no duo bot mate / enemy: %s" % info)
        v.cnj(name_r, "SETUP: no duo bot mate / enemy: %s" % info)
        return
    iso = s.js(ISO_JS)
    if not iso:
        v.cnj(name_d, "SETUP: no isolated flat spot")
        v.cnj(name_r, "SETUP: no isolated flat spot")
        return
    s.guard_player(False)
    L.guard_ids(s, [info["mate"]])
    eps = {30: [], 50: []}
    # (W9 R1B) the 50 m episodes first: under a plant whose mate never revives (no-revive-threat) every episode runs its full cap, and the 50 m
    # set, run after four capped 30 m episodes, met the closing storm at the isolated spot (the human died in it: setup lost, could-not-judge)
    for threat in (50, 30):
        for _ in range(DITHER_N):
            r = s.js(DITHER_JS, [info["me"], info["mate"], info["foe"], iso["x"], iso["z"], threat, DITHER_CAP_S, DITHER_PEEK_S, DITHER_MATE_M])
            eps[threat].append(r)
            if r.get("error") or (r.get("rescued") and not r["rescued"]["up"]) or r.get("died") is not None:
                break
    L.guard_ids(s, [])
    v.data["dither"] = eps
    good30 = [r for r in eps[30] if not r.get("error")]
    good50 = [r for r in eps[50] if not r.get("error")]
    brief = lambda rs: [{k: r.get(k) for k in ("flips", "revStart", "revived", "died", "bleedLeftS", "rescued", "seenN", "otherTarget", "minFoeD")} for r in rs]
    if len(good30) < 3 or sum(1 for r in good30 if r["seenN"] > 0) < 2:
        v.cnj(name_d, "SETUP missed: %d usable episodes (want >= 3, the mate saw the enemy in >= 2): %s" % (len(good30), brief(eps[30])))
    else:
        fl = [r["flips"] for r in good30]
        v.check(name_d, statistics.median(fl) <= DITHER_MED_MAX and max(fl) <= DITHER_MAX_MAX,
                {"flips": fl, "median": statistics.median(fl), "max": max(fl), "episodes": brief(good30)}, "median <= %d, max <= %d" % (DITHER_MED_MAX, DITHER_MAX_MAX))
    if len(good50) < 3:
        v.cnj(name_r, "SETUP missed: %d usable episodes (want >= 3): %s" % (len(good50), brief(eps[50])))
    else:
        started = [r for r in good50 if r["revStart"] is not None and (r["died"] is None or r["revStart"] < r["died"])]
        pct = 100.0 * len(started) / len(good50)
        v.check(name_r, pct >= REVSTART_MIN, {"startedPct": round(pct, 1), "started": len(started), "episodes": brief(good50)}, ">= %.0f %%" % REVSTART_MIN)
    L.errors_row(v, s, "errors [dither]")


# ───────────────────────── part HUMAN2: two pages, the squad relay stand-in ─────────────────────────
def part_human2(args, v):
    rig, SQ = L.squad_rig(args)
    try:
        ctx, hpg, hrec, gpg, grec, code = L.squad_pair(rig, SQ, args, "dbno")
        ids = {k: pg.evaluate("() => { const W = window.__LC__.W; return { me: W.player.id, team: W.player.teamId, mode: W.match && W.match.mode }; }") for k, pg in (("host", hpg), ("guest", gpg))}
        v.data["human2_ids"] = ids
        v.check("human2: both humans on one team in a duo", ids["host"]["team"] is not None and ids["host"]["team"] == ids["guest"]["team"] and ids["host"]["mode"] == "duo",
                ids, "same team, duo")
        g_id = ids["guest"]["me"]
        # SETUP (D16, fix round): one squad session, both match clocks >= 0.6 x real time (net.js's watchdogs and the revive channel's relay
        # slack run on the wall clock: a starved page fails the revive rows by itself - gateA 10-27 01:55, 4 other Chromes: 'guest: null')
        ok_s, sess = L.pair_session(hpg, gpg, ids["host"]["me"], g_id)
        hpg.bring_to_front()
        rates = L.pair_rates(hpg, gpg)
        v.info("human2: pair session + rates (host match clock x real time, host / guest fps)", {"session": sess, "rates": rates})
        if not ok_s or not rates["ok"]:
            v.cnj("human2: the two-page rows", "SETUP missed: %s" % ("the pair is not one squad session: %s" % sess if not ok_s else "the box is starved - sim rates %s" % rates))
            return
        # both bodies together on open ground (host page moves its own body; guest its own)
        spot = hpg.evaluate(ISO_JS)
        if not spot:
            raise C.EnvFailure("human2: no isolated spot")
        for pg, dx in ((hpg, 0.0), (gpg, 6.0)):
            pg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); }", [spot["x"] + dx, spot["z"]])
        # state travels P2P first (ffg_rtc.js DataChannels): the relay stand-in's size log (p23lib.fake_sb_plus) saw no state packet with the DCs
        # open (dbno_h2_all5 10-26: upBytes null) - log the envelope size on the guest's RTC send too; whichever path carried >= 10 is judged
        gpg.evaluate("""() => { const S = window.__LC__.W.net; if (!S || !S.rtc || S.rtc.__p23sz) return; const f = S.rtc.sendState;
            S.rtc.sendState = function (env) { try { if (env && env.t === 'state') { const A = window.__SQ_STATE_RTC__ = window.__SQ_STATE_RTC__ || []; A.push(JSON.stringify(env.d).length); if (A.length > 600) A.shift(); window.__SQ_STATE_LAST__ = env.d; } } catch (e) {}
              return f.apply(this, arguments); }; S.rtc.__p23sz = true; }""")
        hpg.wait_for_timeout(2500)
        size_js = ("() => { const pick = (S) => (S || []).slice(-40); const R = pick(window.__SQ_STATE_RTC__), B = pick(window.__SQ_STATE__); const S = R.length >= 10 ? R : B;"
                   " return S.length >= 10 ? S.reduce((a, b) => a + b, 0) / S.length : null; }")
        up_b = gpg.evaluate(size_js)
        keys_js = "() => { const d = window.__SQ_STATE_LAST__; const me = d && (Array.isArray(d.p) ? d.p[0] : d); return d ? { top: Object.keys(d).sort(), sample: JSON.stringify(d).slice(0, 240) } : null; }"
        up_k = gpg.evaluate(keys_js)
        gpg.bring_to_front()          # the page that acts must be the visible one: a background tab gets no rAF, so its game does not tick
        src = gpg.evaluate("() => { const W = window.__LC__.W, p = W.player; const e = W.actors.find((a) => a.isBot && a.alive && a.teamId !== p.teamId); return e && e.id; }")
        gpg.evaluate("(src) => { const W = window.__LC__.W, p = W.player; p.hp = 100; p.shield = 0; W.hurtActor(p, 250, src, 'ar', false); }", src)
        seen = SQ.wait(hpg, "(id) => { const a = window.__LC__.W.actorById.get(id); return a && a.downed ? window.__LC__.W.t : null; }", 1.0, 0.05, g_id)
        gd = gpg.evaluate("() => { const p = window.__LC__.W.player; return { alive: p.alive, downed: !!p.downed }; }")
        v.check("human2: knocked on its own page, seen downed on the host's within 1 s", gd["downed"] and gd["alive"] and seen is not None, {"guest": gd, "hostSaw": seen}, "downed both")
        # the downed size is read STILL, like the up size (dbno_h2_all6 10-26 read it after the crawl: 121.2 vs 115.8 B - a moving body's
        # non-zero velocity / changing position digits, not the downed flag); 2.5 s of stillness refills the 40-packet window
        gpg.wait_for_timeout(2500)
        dn_b = gpg.evaluate(size_js)
        dn_k = gpg.evaluate(keys_js)
        p0 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return [a.pos.x, a.pos.z]; }", g_id)
        gpg.keyboard.down("KeyW")
        gpg.wait_for_timeout(2500)
        gpg.keyboard.up("KeyW")
        hpg.wait_for_timeout(800)
        p1 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return [a.pos.x, a.pos.z]; }", g_id)
        moved = ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
        v.check("human2: the guest crawls (real W) and the host sees it move (> 1 m)", moved > 1.0, {"movedOnHostM": round(moved, 2)}, "> 1 m")
        gp = gpg.evaluate("() => { const p = window.__LC__.W.player.pos; return [p.x, p.z]; }")
        hpg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x + 1.2, W.map.heightAt(x + 1.2, z), z); p.vel.set(0, 0, 0); }", gp)
        hpg.bring_to_front()          # the reviver's page ticks the 5 s channel (dbno_h2_all5: the host was the hidden tab, no revive)
        hpg.wait_for_timeout(500)
        vis = {k: pg.evaluate("() => document.visibilityState") for k, pg in (("host", hpg), ("guest", gpg))}
        v.info("human2: page visibility during the revive", vis)
        # R2 (harness): the row judges a real E hold of 5 s of GAME time, not 5.6 s of wall time. reviveStep (player.js) adds the frame dt to
        # _reviveT, so on a loaded box (host clock 0.877-0.983 x real, R1 player lane) a fixed 5.6 s real hold ran out at reviveT 4.57-5.00 -
        # a coin flip on head and base alike. Now E is held until the host's sim completes the revive, or until the cap (5 s / the host's sim
        # rate measured live over the hold) + 1.5 s real = 1.5 s real after the host's clock has run REVIVE_S since E went down (the rate is
        # read live because it moves during the hold: r2 run 1 read 0.857 before it and the channel reached only 3.4 s in 7.4 s real);
        # 30 s real absolute. The channel's game time (reviveStart -> actorRevived on the host's clock) is judged: 5.0 +- 0.25 s (R3: against the
        # contract's fixed C-DBNO 5 s, C_REVIVE_S, never the live W.SIM.REVIVE_S - a build that changed REVIVE_S would have moved the bar with it).
        hpg.evaluate("""(gid) => { const W = window.__LC__.W, p = W.player; const Q = window.__P23H2__ = { start: null, done: null, cancels: 0 };
            W.events.on('reviveStart', (a, b) => { if (a === p && b && b.id === gid && Q.start == null) Q.start = W.t; });
            W.events.on('reviveCancel', (a, b) => { if (a === p && Q.done == null) Q.cancels++; });
            W.events.on('actorRevived', (t, a) => { if (a === p && t && t.id === gid && Q.done == null) Q.done = W.t; }); }""", g_id)
        h_rate = L.sim_rates(hpg, secs=1.5)[0]
        rs_h = hpg.evaluate("() => window.__LC__.W.SIM.REVIVE_S")
        short = getattr(args, "control", None) == "h2-short-hold"     # planted control: E released after 3 s of game time - MUST FAIL
        poll_js = "() => { const Q = window.__P23H2__, W = window.__LC__.W; return { t: W.t, start: Q.start, done: Q.done }; }"
        hpg.keyboard.down("KeyE")
        t_e = time.time()
        g0 = hpg.evaluate("() => window.__LC__.W.t")
        reach_t, why, q = None, "abs-cap", None
        while time.time() - t_e < 30.0:
            q = hpg.evaluate(poll_js)
            now = time.time()
            if short and q["start"] is not None and q["t"] - q["start"] >= 3.0:
                why = "control-3s"
                break
            if not short and q["done"] is not None:
                why = "revived"
                break
            if q["t"] - g0 >= rs_h and reach_t is None:
                reach_t = now
            if not short and reach_t is not None and now - reach_t >= 1.5:
                why = "cap"
                break
            hpg.wait_for_timeout(50)
        held_s = round(time.time() - t_e, 2)
        hpg.keyboard.up("KeyE")
        hold_rate = round((q["t"] - g0) / max(0.001, held_s), 3) if q else None
        cap_s = round(rs_h / hold_rate + 1.5, 2) if hold_rate else None
        h2q = hpg.evaluate("() => { const Q = window.__P23H2__, W = window.__LC__.W; return { start: Q.start, done: Q.done, cancels: Q.cancels, reviveT: W.player._reviveT }; }")
        game_s = round(h2q["done"] - h2q["start"], 3) if h2q["start"] is not None and h2q["done"] is not None else None
        rev = SQ.wait(gpg, "() => { const p = window.__LC__.W.player; return p.alive && !p.downed ? { hp: p.hp } : null; }", 4, 0.1)
        hup = SQ.wait(hpg, "(id) => { const a = window.__LC__.W.actorById.get(id); return a && a.alive && !a.downed; }", 3, 0.1, g_id)
        v.check("human2: the host's real 5 s E revives the guest: 30 hp on its page, up on the host's", bool(rev) and abs(rev["hp"] - 30) <= 1 and bool(hup)
                and game_s is not None and abs(game_s - C_REVIVE_S) <= 0.25,
                {"guest": rev, "hostSeesUp": hup, "channelGameS": game_s, "contractS": C_REVIVE_S, "K.REVIVE_S": rs_h, "hostSimRateBefore": h_rate, "hostSimRateHold": hold_rate, "capRealS": cap_s,
                 "heldRealS": held_s, "released": why, "host": h2q, "control": "h2-short-hold" if short else None},
                "revive completes; channel 5.0 +- 0.25 s of game time; hp 30, up")
        v.check("human2: per-tick 'state' message the same size downed as up (+-4 B)", up_b is not None and dn_b is not None and abs(dn_b - up_b) <= 4,
                {"upBytes": up_b and round(up_b, 1), "downedBytes": dn_b and round(dn_b, 1), "upKeys": up_k, "downedKeys": dn_k}, "+-4 B (both still)")
        for rec in (hrec, grec):
            v.check("human2: %s - 0 console / page errors, 0 failed requests" % rec.name.split("/")[1], rec.clean(), rec.problems())
    finally:
        rig.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="solo,bot,human2")
    ap.add_argument("--control", default=None, choices=["h2-short-hold"],
                    help="harness-side planted control (this gate must then FAIL): h2-short-hold = the host releases E after 3 s of game time")
    args = L.parse(ap)
    parts = set(args.parts.split(","))
    os.makedirs(os.path.join(C.REPORTS, "p23_shots"), exist_ok=True)

    def body(v):
        if "solo" in parts:
            part_solo(args, v)
        if "bot" in parts:
            part_bot(args, v)
        if "human2" in parts:
            part_human2(args, v)
    return C.run_gate("p23_dbno", body, args)


if __name__ == "__main__":
    sys.exit(main())
