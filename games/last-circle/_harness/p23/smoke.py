#!/usr/bin/env python
"""smoke - C-SMOKE / LC-14 round 2: the smoke grenade. Lanes: sim (weapons.js keeps W.smokes = [{x, y, z, r, t0, t1}] when a smoke lands; K.SMOKE),
maps (W.map.losBlocked treats a segment through a live smoke sphere as blocked), fx (the clouds), bots (throw + respect). Plan gate: "smoke cuts
bot line of sight to 0 for its lifetime, at +0.3 ms or less with 3 smokes on the iGPU". Built dark (loot weight 0) until the integrator turns it on.

    python _harness/p23/smoke.py --disk
    python _harness/p23/smoke.py --rev 9aa2b746                 # control: the P2 base (no smoke) - MUST FAIL
    python _harness/p23/smoke.py --disk --plant los-ignores     # losBlocked called with W.smokes emptied - MUST FAIL (bot sight row)
    python _harness/p23/smoke.py --disk --plant short-life      # every smoke ends 2 s after it starts - MUST FAIL (lifetime row)
    python _harness/p23/smoke.py --lanes all                    # validation: every lane's work served over the base

STANDARD solo match (Savanna seed 7), landed under the guard, the human moved to an isolated flat spot, loop frozen, frames stepped at 60 Hz:
  contract       K.SMOKE (lifeS, r), W.map.losBlocked
  spawn          a REAL throw (a smoke in slot 4, LMB, pitch 0.25): one W.smokes entry {x, y, z, r, t0, t1} within 4 s, 6-35 m ahead (a lob + roll: PUBG ~30 m)
  lifetime       t1 - t0 = K.SMOKE.lifeS (+-0.5 s) and >= 15 s (PUBG / Apex class); the entry is gone after t1 (+1 s)
  los            losBlocked through the cloud's centre at 1.2 m: false before the throw, true every 0.25 s from t0 + 2 s to t1 - 1 s, false after t1
  bot-sight      an enemy bot pinned 26 m away facing the human (positive control first: it shoots the human in the open within 6 s); the smoke
                 between them: from t0 + 2 s to t1 - 1 s it lands 0 hits on the human
  programs       the first cloud links no shader program after the first rendered frame of it (fx warmed)
  cost           GPU frame time with 3 live smokes in view minus none, ABAB x 4 at 60 rendered frames: median <= +0.3 ms (the iGPU: --gpu d3d11);
                 COUNTED on a quiet box (no other automated Chrome), else information (the shared GPU's timer counts the others' work)
  errors
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "los-ignores": "const f0 = W.map.losBlocked; W.map.losBlocked = function () { const s0 = W.smokes; W.smokes = []; try { return f0.apply(this, arguments); } finally { W.smokes = s0; } }",
    "short-life": "W.kernel._updaters.push(() => { for (const q of (W.smokes || [])) if (q.t1 > q.t0 + 2) q.t1 = q.t0 + 2; })",
}

ISO_JS = r"""() => { const W = window.__LC__.W, M = W.map, p = W.player; const others = W.actors.filter((a) => a.alive && a !== p);
  // a DETERMINISTIC grid sweep (was 4,000 Math.random samples needing 120 m from every actor + a 34 m collider-free disc: none on the
  // Savanna of the lanes' world); the test needs open flat ground 30 m around (the bot sits 26 m north) and quiet: the farthest such
  // spot from every other actor wins, >= 60 m preferred
  const out = [];
  const flat = (x, z) => { const h = M.heightAt(x, z); if (h < M.waterY + 1) return false;
    for (let r = 4; r <= 30; r += 6.5) for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (Math.abs(M.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > 0.8) return false; }
    for (const c of M.queryColliders(x, z - 13, 22, out)) if (!c.dead && c.maxY > M.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) + 0.3) return false; return true; };
  let best = null; const span = M.half * 0.8, step = 16;
  for (let x = -span; x <= span; x += step) for (let z = -span; z <= span; z += step) {
    const d = others.reduce((m, a) => Math.min(m, Math.hypot(a.pos.x - x, a.pos.z - z)), 1e9); if (best && d <= best.d) continue; if (!flat(x, z)) continue;
    best = { x, z, d: +d.toFixed(1), y: M.heightAt(x, z) }; }
  return best && best.d >= 40 ? best : null; }"""
SNAP_JS = r"""() => { const W = window.__LC__.W; return (W.smokes || []).map((q) => ({ x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2), r: +(q.r || 0).toFixed(2), t0: +(q.t0 || 0).toFixed(2), t1: +(q.t1 || 0).toFixed(2) })); }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)

    def body(v):
        with C.Session(args, "p23_smoke") as s:
            s.boot()
            L.dismiss_cards(s)
            v.data["start"] = L.start(s, "standard", 7, "ashgrid", team="solo", guard=True)
            s.land(140, protect=True)
            s.freeze_loop()
            s.install_pump()
            have = L.contract(s, {"K.SMOKE": "!!K.SMOKE && K.SMOKE.lifeS > 0 && K.SMOKE.r > 0", "W.map.losBlocked": "typeof W.map.losBlocked === 'function'",
                                  "smoke item": "!!(K.CONSUMABLES && K.CONSUMABLES.smoke)"})
            L.contract_row(v, "contract (K.SMOKE, K.CONSUMABLES.smoke, W.map.losBlocked)", have)
            if not all(have.values()):
                L.errors_row(v, s)
                return
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            iso = s.js(ISO_JS)
            v.data["iso"] = iso
            if not iso:
                v.cnj("spawn", "no isolated flat spot")
                return
            life = s.js("() => window.__LC__.W.SIM.SMOKE.lifeS")
            me = s.js("() => window.__LC__.W.player.id")
            s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.input.yaw = 0; p.input.pitch = 0; }", [iso["x"], iso["z"]])
            # the enemy bot 26 m ahead (-z = yaw 0 forward), pinned, facing the human
            e = s.js("() => { const W = window.__LC__.W, p = W.player; const b = W.actors.find((a) => a.isBot && a.alive); return b && b.id; }")
            ex, ez = iso["x"], iso["z"] - 26
            ey = s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z)", [ex, ez])
            s.js("([id, x, z]) => { const W = window.__LC__.W, b = W.actorById.get(id); b.pos.set(x, W.map.heightAt(x, z), z); b.vel.set(0, 0, 0); b.onGround = true; b.gliding = false;"
                 " b.inventory.slots[1] = { kind: 'weapon', id: 'ar', rarity: 2, mag: 30 }; b.inventory.ammo.medium = 999; W.equipSlot(b, 1); }", [e, ex, ez])
            L.pin_actor(s, e, [ex, ey, ez])
            L.guard_ids(s, [e])
            s.js("([me, e]) => { const W = window.__LC__.W; window.__P23K__ = { hits: [], shots: 0 }; W.events.on('actorHurt', (a, d) => { if (a && a.id === me && d && d.attackerId === e) window.__P23K__.hits.push(+W.t.toFixed(2)); });"
                 " W.events.on('shotFired', (a) => { if (a && a.id === e) window.__P23K__.shots++; }); }", [me, e])
            # positive control: in the open the bot finds and shoots the human within 6 s
            t_open = s.js("() => window.__LC__.W.t")
            s.step_frames(360, 1 / 60)
            ctrl = s.js("(t) => ({ hits: window.__P23K__.hits.filter((x) => x >= t).length, shots: window.__P23K__.shots })", t_open)
            # what the bot was doing (names a control that never fired: no weapon / no ammo / no target / asleep)
            ctrl["bot"] = s.safe_js("""(id) => { const W = window.__LC__.W, b = W.actorById.get(id), p = W.player; if (!b) return null; const w = b.weapon, br = b.brain || {};
                const pick = (o) => { const r = {}; for (const k in o) { const x = o[k]; if (x == null || typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') r[k] = x; else if (x && x.id) r[k] = 'actor:' + x.id; } return r; };
                return { alive: b.alive, weapon: w ? { id: w.id, magAmmo: w.magAmmo, state: w.state } : null, ammo: b.inventory && b.inventory.ammo, brain: pick(br),
                         dist: +Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z).toFixed(1), los: W.map.losBlocked(b.pos.x, b.pos.y + 1.5, b.pos.z, p.pos.x, p.pos.y + 1.2, p.pos.z) }; }""", e, default=None)
            v.data["openControl"] = ctrl
            # the line through the future cloud: from the bot's eye to the human's chest
            seg = [ex, ey + 1.5, ez, iso["x"], iso["y"] + 1.2, iso["z"]]
            before = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", seg)
            # a REAL throw: smoke in slot 4, LMB, pitch 0.25
            L.lock_pointer(s)
            s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[3] = { kind: 'consumable', id: 'smoke', count: 3 }; }")
            s.press("Digit4")
            s.step_frames(30, 1 / 60)
            s.js("() => { const p = window.__LC__.W.player; p.input.yaw = 0; p.input.pitch = 0.25; p.recoilPitch = 0; }")
            s.step_frames(10, 1 / 60)
            s.page.mouse.down(button="left")
            s.step_frames(1, 1 / 60)
            s.page.mouse.up(button="left")
            prog0 = None
            sm = []
            for _ in range(240):
                s.step_frames(1, 1 / 60, render=True)
                sm = s.js(SNAP_JS)
                if sm:
                    prog0 = L.programs(s)
                    break
            v.data["smokes"] = sm
            q = sm[0] if sm else None
            ahead = None if not q else ((q["x"] - iso["x"]) ** 2 + (q["z"] - iso["z"]) ** 2) ** 0.5
            v.check("spawn (a real throw: one W.smokes entry {x,y,z,r,t0,t1} within 4 s, 6-35 m ahead)", len(sm) == 1 and q["r"] > 0 and q["t1"] > q["t0"] and 6 <= ahead <= 35,
                    {"smokes": sm, "aheadM": ahead and round(ahead, 1)}, "1 entry, 6-35 m")
            if not q:
                L.errors_row(v, s)
                return
            s.step_frames(30, 1 / 60, render=True)
            prog1 = L.programs(s)
            s.screenshot(os.path.join(shots, "smoke_cloud.png"))
            v.check("programs (the first cloud links no shader program after its first rendered frame)", prog0 is not None and prog1 == prog0, {"atFirstFrame": prog0, "after": prog1}, "unchanged")
            # re-aim the line through the cloud's centre (the bot -> the human line passes the landing point only roughly)
            seg_c = [q["x"], q["y"], q["z"] - 12, q["x"], q["y"], q["z"] + 12]
            samples, last_present = [], None
            t_from, t_to = q["t0"] + 2.0, q["t1"] - 1.0
            while True:
                t = s.js("() => window.__LC__.W.t")
                if t > q["t1"] + 1.5:
                    break
                if s.js("() => (window.__LC__.W.smokes || []).length > 0"):
                    last_present = round(t, 2)
                b = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", seg_c)
                bs = s.js("(g) => window.__LC__.W.map.losBlocked(...g)", [ex, ey + 1.5, ez, iso["x"], iso["y"] + 1.2, iso["z"]])
                samples.append((round(t, 2), bool(b), bool(bs)))
                s.step_frames(15, 1 / 60)
            hits = s.js("([a, b]) => window.__P23K__.hits.filter((x) => x >= a && x <= b)", [t_from, t_to])
            after = s.js(SNAP_JS)
            span = q["t1"] - q["t0"]
            seen = None if last_present is None else round(last_present - q["t0"], 2)
            v.check("lifetime (t1 - t0 = K.SMOKE.lifeS +-0.5 s, >= 15 s, observed in W.smokes that long (+-0.6 s); gone after t1 + 1 s)",
                    abs(span - life) <= 0.5 and span >= 15 and seen is not None and abs(seen - span) <= 0.6 and not after,
                    {"spanS": round(span, 2), "observedS": seen, "K.SMOKE.lifeS": life, "afterT1": after}, "lifeS, >= 15 s, gone")
            mid = [x for x in samples if t_from <= x[0] <= t_to]
            late = [x for x in samples if x[0] > q["t1"] + 0.6]
            v.check("los (through the centre: open before the throw, blocked from t0 + 2 s to t1 - 1 s, open after t1)",
                    before is False and mid and all(x[1] for x in mid) and late and not any(x[1] for x in late),
                    {"before": before, "midBlocked": "%d/%d" % (sum(1 for x in mid if x[1]), len(mid)), "lateBlocked": sum(1 for x in late if x[1])}, "open / blocked / open")
            sight_blocked = "%d/%d" % (sum(1 for x in mid if x[2]), len(mid))
            v.check("bot-sight (open control: the bot hits the human; through the smoke: 0 hits from t0 + 2 s to t1 - 1 s)", ctrl["hits"] > 0 and not hits,
                    {"openHits": ctrl["hits"], "openShots": ctrl["shots"], "hitsInSmoke": hits, "botLineBlocked": sight_blocked}, "> 0 open, 0 in smoke")
            # cost: 3 smokes in view vs none, ABAB (GPU timer on the default iGPU profile)
            L.pin_actor(s, None)
            s.js("() => { const W = window.__LC__.W, p = W.player; p.input.pitch = 0.05; }")
            arms = {"on": [], "off": []}
            for k in range(4):
                for arm in ("off", "on"):
                    if arm == "on":
                        s.js("([x, y, z]) => { const W = window.__LC__.W, t = W.t; W.smokes = W.smokes || []; W.smokes.length = 0;"
                             " for (let i = 0; i < 3; i++) W.smokes.push({ x: x - 8 + 8 * i, y: y + 1.2, z: z - 16, r: W.SIM.SMOKE.r, rMax: W.SIM.SMOKE.r, t0: t - 5, t1: t + 60 }); }",
                             [iso["x"], iso["y"], iso["z"]])
                    else:
                        s.js("() => { const W = window.__LC__.W; if (W.smokes) W.smokes.length = 0; }")
                    s.step_frames(20, 1 / 60, render=True)
                    g = L.gpu_ms(s, 60)
                    if g:
                        arms[arm].append(L.med(g))
            s.js("() => { const W = window.__LC__.W; if (W.smokes) W.smokes.length = 0; }")
            diffs = [a - b for a, b in zip(arms["on"], arms["off"]) if a is not None and b is not None]
            if not diffs:
                v.cnj("cost (3 smokes in view: GPU <= +0.3 ms)", "no GPU timer on this Chrome (EXT_disjoint_timer_query) or no frames")
            else:
                d = statistics.median(diffs)
                det = {"medianDiffMs": round(d, 3), "on": arms["on"], "off": arms["off"], "otherAutomatedChromes": v.data.get("otherAutomatedChromes")}
                # the GPU timer on a SHARED iGPU counts the other Chromes' work queued in between (seen: 120-4000 ms "frames" with 10 other
                # automated Chromes): the row COUNTS on a quiet box only, else it is information (tierprof's rule; the bar is unchanged)
                if v.data.get("otherAutomatedChromes") == 0:
                    v.check("cost (3 smokes in view minus none, ABAB x 4: median GPU <= +0.3 ms, quiet box)", d <= 0.3, det, "<= 0.3 ms")
                else:
                    v.info("cost (3 smokes in view minus none, ABAB x 4: median GPU <= +0.3 ms) would %s - the box is SHARED: not judged" % ("PASS" if d <= 0.3 else "FAIL"), det)
            L.errors_row(v, s)
    return C.run_gate("p23_smoke", body, args)


if __name__ == "__main__":
    sys.exit(main())
