#!/usr/bin/env python
"""Boss-threat lane (PC-02) — Size V shots of named boss attacks frozen MID-TELEGRAPH (scratch, not a gate).

    python _harness/scratch/boss_threat_shots.py --base http://localhost:5210/ \
        --want caisson4:hookDrop,caisson4:winchLeash,irongully:pawSlam

?dev=1: cheat.rank(4) → god + noSpawns → cheat.boss; the phase is forced by lowering boss hp (P2 attacks);
the titan stands still facing the boss; when the wanted attack's tell is 45–80 % through its windup the
sim is frozen (__BT__.freeze) and the page is captured. Writes PNGs + a JSON of the measured shape vs
the titan (radius, height) to _harness/_reports/boss_threat/.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), "_reports", "boss_threat")
BIOME = {"caisson4": "lockwater", "irongully": "whitestacks"}
PHASE = {"hookDrop": 1, "hookLane": 1, "winchLeash": 2, "boomSweep": 2, "legStomp": 3,
         "pawSlam": 1, "coneBreath": 1, "plateVolley": 2, "ridgeCharge": 2}

PROBE_JS = r"""
(p) => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.titan) return null;
  const T = W.titan, b = W.boss;
  const out = { t: W.t, titan: { x: T.x, z: T.z, height: T.height, radius: T.radius, rank: T.rank } };
  if (!b) return out;
  if (b.alive && b.introT <= 0 && p.phase > 1) {
    const f = p.phase === 2 ? 0.6 : 0.3;
    if (b.hp > b.maxHp * f) b.hp = b.maxHp * f;
  }
  out.boss = { id: b.id, attack: b.attack, phase: b.phase, introT: b.introT, x: b.x, z: b.z, H: b.data.H };
  let best = null;
  for (const tg of (W.telegraphs || [])) {
    if (!tg.alive || tg.owner !== 'boss' || tg.fired || !(tg.windup > 0)) continue;
    const frac = tg.t / tg.windup;
    const c = { tag: tg.tag, style: tg.style, frac, windup: +tg.windup.toFixed(2), shape: tg.shape };
    if (!best || frac > best.frac) best = c;
  }
  out.tg = best;
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="voltkite")
    ap.add_argument("--want", default="caisson4:hookDrop,caisson4:winchLeash,irongully:pawSlam")
    ap.add_argument("--seconds", type=float, default=90)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--near", type=float, default=0.0, help="only freeze when the titan is within this × H of the boss")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    wants = [w.split(":") for w in args.want.split(",")]
    rep = []
    sess = Session(args, "boss_threat_shots")
    sess.start()
    try:
        for boss, attack in wants:
            url = build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=BIOME[boss], seed=args.seed, noslate=1)
            sess.goto(url)
            sess.wait_bt(90)
            ok, scr = sess.wait_screen(("play",), 90)
            print("run", boss, attack, ok, scr, flush=True)
            sess.cheat("god", True)
            sess.cheat("noSpawns", True)
            sess.cheat("rank", 4)
            time.sleep(2.0)
            sess.cheat("killAll")
            sess.cheat("boss")
            ph = PHASE.get(attack, 1)
            got = None
            t_end = time.time() + args.seconds
            while time.time() < t_end:
                o = sess.safe_js(PROBE_JS, {"phase": ph}) or {}
                if sess.screen() == "draft":
                    sess.press("Digit1")
                    time.sleep(0.4)
                    continue
                bo = o.get("boss") or {}
                tg = o.get("tg")
                ti = o.get("titan") or {}
                near_ok = True
                if args.near > 0 and bo.get("x") is not None and ti.get("x") is not None:
                    near_ok = ((bo["x"] - ti["x"]) ** 2 + (bo["z"] - ti["z"]) ** 2) ** 0.5 < args.near * (ti.get("height") or 60)
                if bo.get("attack") == attack and tg and 0.45 <= tg["frac"] <= 0.8 and near_ok:
                    sess.bt_call("freeze", True)
                    time.sleep(0.6)
                    o2 = sess.safe_js(PROBE_JS, {"phase": 0}) or o
                    path = os.path.join(OUT, "%s_%s_sizeV%s.png" % (boss, attack, "_near" if args.near > 0 else ""))
                    sess.screenshot(path)
                    got = {"boss": boss, "attack": attack, "png": path, "titan": o2.get("titan"), "tg": o2.get("tg"),
                           "bossState": o2.get("boss")}
                    sess.bt_call("freeze", False)
                    break
                time.sleep(0.05)
            print(json.dumps(got or {"boss": boss, "attack": attack, "missed": True}), flush=True)
            rep.append(got or {"boss": boss, "attack": attack, "missed": True})
    finally:
        sess.close()
    with open(os.path.join(OUT, "shots%s.json" % ("_near" if args.near > 0 else "")), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
