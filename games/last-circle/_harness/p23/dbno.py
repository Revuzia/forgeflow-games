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
    python _harness/p23/dbno.py --lanes all                         # validation: every lane's work served over the base

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
Part HUMAN2 (two pages, the squad relay stand-in of squadguard_live, a REAL duo match on both): the guest is knocked on its own page; the host
  sees the guest's body downed within 1 s; the guest crawls (real W) and the host sees it move; the host (teleported 1.2 m away) holds real E
  5.3 s; the guest ends revived on 30 hp on its page and up on the host's; the per-tick 'state' message is the same size downed as up (+-4 B).
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

PLANTS = {
    "crawl-fast": "K.DBNO_CRAWL = 4; if (K.DBNO) K.DBNO.CRAWL = 4",
    "no-bleed": "K.DBNO_BLEED_HPS = 0; if (K.DBNO) K.DBNO.BLEED_HPS = 0; if (typeof K.dbnoBleedRate === 'function') K.dbnoBleedRate = () => 0",
    "revive-quick": "K.REVIVE_S = 1; if (K.DBNO) K.DBNO.REVIVE_S = 1",
}
CONTRACT = {
    "K.DBNO_CRAWL": "typeof K.DBNO_CRAWL === 'number'",
    "K.DBNO_BLEED_HPS": "typeof K.DBNO_BLEED_HPS === 'number'",
    "K.REVIVE_S": "typeof K.REVIVE_S === 'number'",
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
        s.boot()
        L.dismiss_cards(s)
        st = L.start(s, "standard", 7, "ashgrid", team="duo", guard=True)
        v.data["bot_start"] = st
        have = L.contract(s, CONTRACT)
        L.contract_row(v, "contract (K.DBNO_CRAWL, K.DBNO_BLEED_HPS, K.REVIVE_S, K.actorHeight, K.TEAM_SIZE)", have)
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
                {"firstHold": [x["n"] for x in part if x["n"] != "shotFired"], "afterCancel": {k: m1[k] for k in ("alive", "downed")}, "channelS": chan, "K.REVIVE_S": rs,
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


# ───────────────────────── part HUMAN2: two pages, the squad relay stand-in ─────────────────────────
def part_human2(args, v):
    import squadguard_live as SQ                                    # the relay stand-in (FAKE_SB) + the lobby helpers, read-only reuse

    class Rig(SQ.Rig):
        def new_ctx(self):
            ctx = super().new_ctx()
            for f in (getattr(self.args, "inject", None) or []):
                with open(f, encoding="utf-8") as fh:
                    ctx.add_init_script(fh.read())
            return ctx

    if C.overlay_specs(args):
        # the squad rig's DiskServer has no overlays: wrap its constructor for this run (validation only)
        ovl = C.overlay_specs(args)
        D0 = C.DiskServer

        class DS(D0):
            def __init__(self, origins, rev=None, game_path=None, overlays=None):
                super().__init__(origins, rev, game_path, overlays=overlays or ovl)
        C.DiskServer = DS
    args.full_now = True
    rig = Rig(args)
    try:
        ctx = rig.new_ctx()
        hpg, hrec = rig.page(ctx, "dbno/host")
        gpg, grec = rig.page(ctx, "dbno/guest")
        for label, pg in (("host", hpg), ("guest", gpg)):
            if SQ.boot_url(pg, args.base, args.boot_timeout) is None:
                raise C.EnvFailure("human2 %s never booted" % label)
        for label, pg in (("host", hpg), ("guest", gpg)):
            if not SQ.open_lobby(pg):
                raise C.EnvFailure("human2 %s: the SQUAD UP lobby never opened" % label)
        code = SQ.host_create(hpg)
        if not code:
            raise C.EnvFailure("human2: no room code")
        SQ.guest_join(gpg, code)
        if not SQ.wait(hpg, "() => document.body.innerText.includes('2 player')", 40):
            raise C.EnvFailure("human2: the guest never showed in the host's lobby")
        SQ.press_start(hpg)
        for pg in (hpg, gpg):
            if not SQ.wait(pg, "() => ['drop','match'].includes(window.__LC__.W.phase)", args.load_timeout, 1.0):
                for _ in range(3):
                    pg.keyboard.press("Enter")
                    pg.wait_for_timeout(1500)
        ok = all(SQ.wait(pg, "() => ['drop','match'].includes(window.__LC__.W.phase)", 120, 1.0) for pg in (hpg, gpg))
        if not ok:
            raise C.EnvFailure("human2: a page never reached the drop")
        land = "() => { const C = window.__LC__, W = C.W, p = W.player; let n = 0; while (n < 900 && p.alive && (p.gliding || !p.onGround || W.phase === 'drop')) { C.fastForward(1 / 30, 1 / 30); p.hp = 100; p.shield = 100; n++; } return { n, onGround: p.onGround }; }"
        for pg in (hpg, gpg):
            pg.evaluate(land)
        ids = {k: pg.evaluate("() => { const W = window.__LC__.W; return { me: W.player.id, team: W.player.teamId, mode: W.match && W.match.mode }; }") for k, pg in (("host", hpg), ("guest", gpg))}
        v.data["human2_ids"] = ids
        v.check("human2: both humans on one team in a duo", ids["host"]["team"] is not None and ids["host"]["team"] == ids["guest"]["team"] and ids["host"]["mode"] == "duo",
                ids, "same team, duo")
        g_id = ids["guest"]["me"]
        # both bodies together on open ground (host page moves its own body; guest its own)
        spot = hpg.evaluate(ISO_JS)
        if not spot:
            raise C.EnvFailure("human2: no isolated spot")
        for pg, dx in ((hpg, 0.0), (gpg, 6.0)):
            pg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); }", [spot["x"] + dx, spot["z"]])
        hpg.wait_for_timeout(2500)
        size_js = "() => { const L = window.__SQ_LOG__ || []; const st = L.filter((m) => m.t === 'state' && m.dir === 'out').slice(-40); return st.length ? st.reduce((s, m) => s + (m.bytes || JSON.stringify(m.d || m).length), 0) / st.length : null; }"
        up_b = gpg.evaluate(size_js)
        src = gpg.evaluate("() => { const W = window.__LC__.W, p = W.player; const e = W.actors.find((a) => a.isBot && a.alive && a.teamId !== p.teamId); return e && e.id; }")
        gpg.evaluate("(src) => { const W = window.__LC__.W, p = W.player; p.hp = 100; p.shield = 0; W.hurtActor(p, 250, src, 'ar', false); }", src)
        seen = SQ.wait(hpg, "(id) => { const a = window.__LC__.W.actorById.get(id); return a && a.downed ? window.__LC__.W.t : null; }", 3, 0.1, g_id)
        gd = gpg.evaluate("() => { const p = window.__LC__.W.player; return { alive: p.alive, downed: !!p.downed }; }")
        v.check("human2: knocked on its own page, seen downed on the host's within 1 s", gd["downed"] and gd["alive"] and seen is not None, {"guest": gd, "hostSaw": seen}, "downed both")
        p0 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return [a.pos.x, a.pos.z]; }", g_id)
        gpg.keyboard.down("KeyW")
        gpg.wait_for_timeout(2500)
        gpg.keyboard.up("KeyW")
        hpg.wait_for_timeout(800)
        p1 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return [a.pos.x, a.pos.z]; }", g_id)
        moved = ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
        dn_b = gpg.evaluate(size_js)
        v.check("human2: the guest crawls (real W) and the host sees it move (> 1 m)", moved > 1.0, {"movedOnHostM": round(moved, 2)}, "> 1 m")
        gp = gpg.evaluate("() => { const p = window.__LC__.W.player.pos; return [p.x, p.z]; }")
        hpg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x + 1.2, W.map.heightAt(x + 1.2, z), z); p.vel.set(0, 0, 0); }", gp)
        hpg.wait_for_timeout(500)
        hpg.keyboard.down("KeyE")
        hpg.wait_for_timeout(5600)
        hpg.keyboard.up("KeyE")
        rev = SQ.wait(gpg, "() => { const p = window.__LC__.W.player; return p.alive && !p.downed ? { hp: p.hp } : null; }", 4, 0.1)
        hup = SQ.wait(hpg, "(id) => { const a = window.__LC__.W.actorById.get(id); return a && a.alive && !a.downed; }", 3, 0.1, g_id)
        v.check("human2: the host's real 5 s E revives the guest: 30 hp on its page, up on the host's", bool(rev) and abs(rev["hp"] - 30) <= 1 and bool(hup),
                {"guest": rev, "hostSeesUp": hup}, "hp 30, up")
        v.check("human2: per-tick 'state' message the same size downed as up (+-4 B)", up_b is not None and dn_b is not None and abs(dn_b - up_b) <= 4,
                {"upBytes": up_b and round(up_b, 1), "downedBytes": dn_b and round(dn_b, 1)}, "+-4 B")
        for rec in (hrec, grec):
            v.check("human2: %s - 0 console / page errors, 0 failed requests" % rec.name.split("/")[1], rec.clean(), rec.problems())
    finally:
        rig.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="solo,bot,human2")
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
