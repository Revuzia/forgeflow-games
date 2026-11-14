#!/usr/bin/env python
"""Gate F: PARKADE-6 JAM with REAL keys in headed Chrome (god, noSpawns, cheat.level, cheat.boss — as framepump.py).
Competent-play policy, 10 Hz: while the till is out (the HUD's HIT THE TILL marker) walk to the spot in front of
the booth; otherwise hold the titan's reach ring round the rig (approach / strafe). Space (hook) when READY.
UPROAR (E) is NEVER pressed, so every JAM point here is earned on the rig's parts (no +0.30 from bossUltHit).
Logs per 1 s of game time: meter, tillOpen, staggerT; counts JAMMED (staggerT rising edges) and tillOpens.

    python _harness/scratch/gf/jamkeys.py --base http://localhost:5178/ --out _harness/scratch/gf/jamkeys --seconds 160
"""
import argparse, json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, world_to_keys  # noqa: E402

REACH = {"molo": 0.75, "voltkite": 2.6, "hearthback": 2.0, "briarwick": 2.1}
OBS = r"""
() => { const W = window.__H_W__ && window.__H_W__(); if (!W || !W.boss) return null; const b = W.boss, T = W.titan;
  return { t: W.t, alive: b.alive, introT: b.introT, x: b.x, z: b.z, h: b.heading, meter: b.meter, stag: b.staggerT,
    till: (b.data && b.data.tillOpen) || 0, tillOpens: (b.data && b.data.tillOpens) || 0, jams: (b.data && b.data.jams) || 0,
    hp: b.hp, maxHp: b.maxHp, phase: b.phase, tx: T.x, tz: T.z, H: T.height, r: T.radius, cd: T.abilityCd,
    tillPart: (b.parts.find(p => p.name === 'till') || {}).strainMul }; }
"""

def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="voltkite")
    ap.add_argument("--level", type=int, default=37)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--seconds", type=float, default=160)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sess = Session(a, "jamkeys"); sess.start()
    rep = {"titan": a.titan, "level": a.level, "seed": a.seed, "rows": []}
    try:
        sess.goto(build_url(a.base, autostart=1, dev=1, titan=a.titan, biome="grideast", seed=a.seed, noslate=1))
        sess.wait_bt(90); ok, scr = sess.wait_screen(("play",), 90); print("run", ok, scr, flush=True)
        sess.cheat("god", True); sess.cheat("noSpawns", True); sess.cheat("level", a.level); time.sleep(2.5)
        for _ in range(60):
            if sess.screen() == "draft": sess.press("Digit1"); time.sleep(0.4)
            else: break
        sess.cheat("killAll"); print("boss", sess.cheat("boss"), flush=True)
        t_end = time.time() + 90
        while time.time() < t_end:
            o = sess.safe_js(OBS) or {}
            if o.get("alive") and o.get("introT", 1) <= 0: break
            if sess.screen() == "draft": sess.press("Digit1")
            time.sleep(0.2)
        o = sess.safe_js(OBS); t0 = o["t"]; last_row = -1; jams = 0; prev_st = 0; peak = 0; held = set(); first_jam = None
        keep = 33 + o["r"] + 10
        wall0 = time.time()
        while time.time() - wall0 < a.seconds * 12:
            o = sess.safe_js(OBS)
            if not o or not o["alive"]: break
            st = o["t"] - t0
            if st >= a.seconds: break
            if sess.screen() == "draft":
                sess.release_all(); held = set(); sess.press("Digit1"); time.sleep(0.3); continue
            if o["stag"] > 0 and prev_st <= 0:
                jams += 1
                if first_jam is None: first_jam = round(st, 1)
            prev_st = o["stag"]; peak = max(peak, o["meter"])
            bx, bz = o["x"] - o["tx"], o["z"] - o["tz"]; d = math.hypot(bx, bz) or 1
            want = max(REACH.get(a.titan, 1.5) * o["H"] + 18, keep + 2)
            if o["till"] > 0 or o["stag"] > 0:
                fx, fz = o["x"] + math.sin(o["h"]) * want, o["z"] + math.cos(o["h"]) * want
                gx, gz = fx - o["tx"], fz - o["tz"]; g = math.hypot(gx, gz)
                dx, dz = (gx, gz) if g > 0.25 * o["H"] else (bx, bz)
                if g <= 0.25 * o["H"] and d < want * 0.9: dx, dz = 0, 0
            elif d > want * 1.15: dx, dz = bx, bz
            elif d < want * 0.7: dx, dz = -bx - 0.6 * bz, -bz + 0.6 * bx
            else: dx, dz = -bz + 0.25 * bx, bx + 0.25 * bz
            ks = world_to_keys(dx, dz)
            if ks != held:
                sess.release_all()
                if ks: sess.hold(sorted(ks))
                held = ks
            if o["cd"] <= 0: sess.press("Space")
            if int(st) != last_row:
                last_row = int(st)
                rep["rows"].append({"t": round(st, 1), "meter": round(o["meter"], 3), "till": round(o["till"], 2), "stag": round(o["stag"], 2), "d": round(d, 1), "hp": round(o["hp"] / o["maxHp"], 3)})
            time.sleep(0.08)
        sess.release_all()
        o = sess.safe_js(OBS) or {}
        rep.update({"game_s": round((o.get("t", t0) - t0), 1), "wall_s": round(time.time() - wall0, 1), "jammed": jams, "first_jam_s": first_jam,
                    "peak_meter": round(peak, 3), "tillOpens": o.get("tillOpens"), "module_jams": o.get("jams"),
                    "boss_hp_left": round(o.get("hp", 0) / max(1, o.get("maxHp", 1)), 3) if o else None, "alive": o.get("alive")})
        sess.screenshot(os.path.join(a.out, "jamkeys_%s.png" % a.titan))
    finally:
        sess.close() if hasattr(sess, "close") else None
    json.dump(rep, open(os.path.join(a.out, "jamkeys_%s.json" % a.titan), "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "rows"}))

if __name__ == "__main__":
    main()
