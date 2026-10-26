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
    python _harness/p23/fall.py --disk --inject F:/lc_p23/harness/stubs/fall_stub.js   # validation against a contract stub

Part HUMAN (PRACTICE, Isla Viva seed 4242, kernel loop frozen, frames stepped, the hp guard OFF during each drop): the player is set
h metres above open, flat ground (nothing within 4 m) with zero velocity and stepped until grounded; hp / shield before and after, every
'fallDamage' event. Heights 1, 3, 4, 6, 10 (shield 100 and shield 0), 15, then 20 (lethal) last. 10 REAL Space jumps on the same ground.
A 20 m drop into deep water.
Part BOTS (a QUICK match on Savanna seed 77, ground start): three bots lifted 10 m and three 20 m over open ground - the same rule
(10 m costs 35-50, 20 m kills); then 180 s of play through fastForward: 0 bot deaths from a fall.
Part GLIDE (a STANDARD match, Isla Viva seed 7): the whole drop through fastForward until every actor stands on the ground: 0 fallDamage
events, 0 hp lost without an attacker at touchdown, for the human and all 49 bots.

Rows: contract (K.FALL_SAFE_V, K.FALL_DMG_PER_V, K.LAND_STAGGER_S numbers) - safe-drops (1 / 3 / 4 m: 0 hp) - jumps (0 hp) - ten-metre
(35-50 hp) - monotonic (damage non-decreasing with height) - lethal-20 (20 m kills at full shield) - shield-untouched (shield 100 before
= 100 after a 10 m drop, hp loss equal to the shield-0 drop) - event (one 'fallDamage' per damaging landing, none otherwise) - stagger
(after the 10 m landing with W held: horizontal speed <= 50 % of walk over the first 0.3 s, back to >= 85 % of walk by 0.8 s; after a 1 m
drop >= 85 % within 0.3 s) - water (0 hp) - bots-rule - bots-avoid - glide - errors.
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
}
TEN_LO, TEN_HI = 35, 50

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
    rows[20] = drop(s, spot, 20)
    R["rows"] = {str(k): {kk: vv for kk, vv in r.items() if kk != "trace"} if r else None for k, r in rows.items()}
    lost = {k: (r["lost"] if r else None) for k, r in rows.items()}
    # the curve the bots row compares against (fall_all3 10-26: bots-rule read "human15": null - nothing stored it, so the row fell back to
    # "> 50 hp" instead of the human's own 15 m)
    R["curve"] = {"10": lost.get("10n"), "15": lost.get(15), "6": lost.get(6)}
    v.check("safe-drops (1 / 3 / 4 m cost 0 hp)", all(lost[h] == 0 for h in (1, 3, 4)), {h: lost[h] for h in (1, 3, 4)}, "0")
    v.check("jumps (10 real Space jumps cost 0 hp, 0 events)", jumps["hp"] == 100 and jumps["ev"] == 0 and jumps["jumps"] >= 8, jumps, "hp 100, 0 events, >= 8 jumps happened")
    ten = lost["10n"]
    v.check("ten-metre (a 10 m drop costs %d-%d hp)" % (TEN_LO, TEN_HI), ten is not None and TEN_LO <= ten <= TEN_HI, {"lost": ten}, "%d-%d" % (TEN_LO, TEN_HI))
    seq = [lost[1], lost[3], lost[4], lost[6], lost["10n"], lost[15]]
    v.check("monotonic (damage non-decreasing 1 -> 15 m)", all(a is not None and b is not None and b >= a for a, b in zip(seq, seq[1:])) and lost[15] > lost[6],
            {"1,3,4,6,10,15 m": seq}, "non-decreasing, 15 m > 6 m")
    r20 = rows[20]
    v.check("lethal-20 (a 20 m drop kills at hp 100 + shield 100)", not r20["after"]["alive"], {"after": r20["after"], "at": r20["at"]}, "dead")
    r10 = rows["10s"]
    v.check("shield-untouched (armour does not absorb a fall)", r10["after"]["alive"] and r10["shieldLost"] == 0 and r10["lost"] == lost["10n"],
            {"withShield": {"hpLost": r10["lost"], "shieldLost": r10["shieldLost"]}, "noShield": {"hpLost": lost["10n"]}}, "shield 100 -> 100, same hp loss")
    damaging = [k for k in rows if rows[k] and rows[k]["lost"] > 0]
    clean = [k for k in rows if rows[k] and rows[k]["lost"] == 0]
    ev_ok = all(len(rows[k]["ev"]) == 1 for k in damaging if k != 20) and all(len(rows[k]["ev"]) == 0 for k in clean) and bool(damaging)
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


BOT_DROP_JS = r"""([hs]) => {
  const W = window.__LC__.W, M = W.map, P = window.__H_PUMP__;
  const bots = W.actors.filter((a) => a.isBot && a.alive && a.onGround && !a.gliding).slice(0, hs.length);
  const out = [];
  bots.forEach((b, i) => { const h = hs[i]; const g = M.heightAt(b.pos.x, b.pos.z); b.hp = 100; b.shield = 0; b.pos.y = g + h; b.vel.set(0, 0, 0); b.onGround = false;
    out.push({ id: b.id, h, g }); });
  const gl = new Set(), fd = new Map(); W.events.on('fallDamage', (a, d) => { if (a) fd.set(a.id, (fd.get(a.id) || 0) + (+d || 0)); });
  for (let f = 0; f < 360; f++) { P.step(1, 1 / 60, false); for (const o of out) { const b = W.actorById.get(o.id); if (b && b.gliding) gl.add(o.id); } }
  return out.map((o) => { const b = W.actorById.get(o.id); return Object.assign(o, { hp: b.hp, alive: !!b.alive, onGround: !!b.onGround, canopy: gl.has(o.id), fallDmg: fd.get(o.id) || 0 }); }); }"""


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
    rows = s.js(BOT_DROP_JS, [[10, 10, 10, 15, 15, 15, 20, 20, 20]])
    R["drops"] = rows
    # the SAME rule as the human: 10 m and 15 m (both below the height at which a falling player can still open the canopy: > 12 m
    # above the ground while already falling fast) cost what the human's drop cost (part human, +- 4 hp for the ground under a bot);
    # 20 m: dead, OR the bot opened its canopy in the air exactly as a player may (SPACE mid-air) and took no fall damage = it avoided
    # the lethal drop (C-FALL "bots avoid lethal drops"). A bot that survives a 20 m drop WITHOUT a canopy fails.
    hum = (v.data.get("human") or {}).get("curve") or {}
    ten = [100 - r["hp"] for r in rows if r["h"] == 10 and r["alive"]]
    fif = [100 - r["hp"] for r in rows if r["h"] == 15 and r["alive"]]
    twenty = [r for r in rows if r["h"] == 20]
    h15 = hum.get("15")
    ok15 = len(fif) == 3 and (all(abs(x - h15) <= 4 for x in fif) if h15 is not None else all(x > TEN_HI for x in fif))
    ok20 = len(twenty) == 3 and all((not r["alive"]) or (r["canopy"] and r["fallDmg"] == 0) for r in twenty)
    ok = len(ten) == 3 and all(TEN_LO <= x <= TEN_HI for x in ten) and ok15 and ok20
    v.check("bots-rule (bots: 10 m costs %d-%d, 15 m = the human's 15 m +- 4 hp, 20 m kills unless the bot opened its canopy mid-air)" % (TEN_LO, TEN_HI), ok,
            {"tenLost": ten, "fifteenLost": fif, "human15": h15,
             "twenty": [{"alive": r["alive"], "canopy": r["canopy"], "fallDmg": round(r["fallDmg"], 2)} for r in twenty]}, "same rule as the human")
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
    ap.add_argument("--parts", default="human,bots,glide")
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
        if "glide" in parts:
            with C.Session(args, "p23_fall_glide") as s:
                part_glide(s, v, args)
                L.errors_row(v, s, "errors [glide]")
    return C.run_gate("p23_fall", body, args)


if __name__ == "__main__":
    sys.exit(main())
