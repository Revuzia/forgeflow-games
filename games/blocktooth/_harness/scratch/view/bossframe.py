#!/usr/bin/env python
"""BOSS FRAMING — default-zoom shots of each boss's largest attacks, frozen late in the windup, with the
boss rig + every live boss telegraph projected through the LIVE camera (max |ndc| ≤ 1 = in frame).

    python _harness/scratch/view/bossframe.py --base http://localhost:5240 --out _shots/bossframe \
        [--want irongully:coneBreath,caisson4:boomSweep,irongully:pawSlam] [--titan molo] [--level 37]

?dev=1: cheat.level(L) → god + noSpawns → cheat.boss; later phases are forced by lowering boss hp;
the titan stands still. When the wanted attack's tell is 70–92 % through its windup the sim is frozen
(__BT__.freeze), the camera spring is left to finish (it keeps running on frame time), and the page is
captured. The camera zoom is never touched (1×).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url  # noqa: E402

BIOME = {"caisson4": "lockwater", "irongully": "whitestacks"}
PHASE = {"hookDrop": 1, "hookLane": 1, "winchLeash": 2, "boomSweep": 2, "legStomp": 3,
         "pawSlam": 1, "coneBreath": 1, "plateVolley": 2, "ridgeCharge": 2}

PROBE_JS = r"""
(p) => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.titan) return null;
  const T = W.titan, b = W.boss;
  const out = { t: W.t, titan: { x: T.x, z: T.z, H: +T.height.toFixed(2), lv: T.level } };
  if (!b) return out;
  if (b.alive && b.introT <= 0 && p.phase > 1) {
    const f = p.phase === 2 ? 0.6 : 0.3;
    if (b.hp > b.maxHp * f) b.hp = b.maxHp * f;
  }
  out.boss = { id: b.id, attack: b.attack, phase: b.phase, introT: b.introT, x: b.x, z: b.z, fightT: b.data.fightT || 0 };
  let best = null;
  for (const tg of (W.telegraphs || [])) {
    if (!tg.alive || tg.owner !== 'boss' || tg.fired || !(tg.windup > 0)) continue;
    const frac = tg.t / tg.windup;
    if (!best || frac > best.frac) best = { tag: tg.tag, style: tg.style, frac };
  }
  out.tg = best;
  return out;
}
"""

FRAME_JS = r"""
() => {
  const W = window.__H_W__(), c = window.__BTCAM__, cam = c.camera, V = cam.position.constructor;
  const T = W.titan, b = W.boss;
  const pts = [];
  const add = (x, y, z, what) => pts.push([x, y, z, what]);
  const shape = (s, what) => {
    const N = 16;
    if (s.k === 'circle' || s.k === 'ring') { const r = s.k === 'circle' ? s.r : s.r1; for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; add(s.x + Math.sin(a) * r, 0, s.z + Math.cos(a) * r, what); } }
    else if (s.k === 'cone') { add(s.x, 0, s.z, what); for (let i = 0; i <= N; i++) { const a = s.dir - s.half + 2 * s.half * i / N; add(s.x + Math.sin(a) * s.r, 0, s.z + Math.cos(a) * s.r, what); } }
    else if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir), h = s.w / 2; for (const t of [0, s.len]) for (const sg of [-1, 1]) add(s.x + fx * t + fz * h * sg, 0, s.z + fz * t - fx * h * sg, what); }
    else if (s.k === 'oval') { const fx = Math.sin(s.rot), fz = Math.cos(s.rot); for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI, lx = Math.sin(a) * s.rx, lz = Math.cos(a) * s.rz; add(s.x + lx * fz + lz * fx, 0, s.z - lx * fx + lz * fz, what); } }
    else if (s.k === 'capsule') { for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; add(s.x0 + Math.sin(a) * s.r, 0, s.z0 + Math.cos(a) * s.r, what); add(s.x1 + Math.sin(a) * s.r, 0, s.z1 + Math.cos(a) * s.r, what); } }
  };
  const tgs = [];
  for (const tg of W.telegraphs) if (tg.alive && tg.owner === 'boss') { shape(tg.shape, 'tg:' + tg.tag); tgs.push(tg.tag); }
  if (b && b.alive) for (const p of b.parts) { add(p.x + p.r, 0, p.z, 'boss'); add(p.x - p.r, 0, p.z, 'boss'); add(p.x, 0, p.z + p.r, 'boss'); add(p.x, 0, p.z - p.r, 'boss'); add(p.x, p.y1, p.z, 'boss'); }
  let maxTg = 0, maxBoss = 0, outN = 0, topY = -9;
  for (const [x, y, z, what] of pts) {
    const v = new V(x, y, z).project(cam);
    if (v.y > topY) topY = v.y;
    const m = Math.max(Math.abs(v.x), Math.abs(v.y));
    if (what === 'boss') maxBoss = Math.max(maxBoss, m); else maxTg = Math.max(maxTg, m);
    if (m > 1) outN++;
  }
  const P = (y) => { const v = new V(T.x, y, T.z).project(cam); return v.y; };
  const K = 2 * Math.tan(15 * Math.PI / 180);
  return { D: +c.distance.toFixed(1), auto: +c.autoDist.toFixed(1), zoom: +c.zoom.toFixed(3),
           curve: +(1.2 / (0.062 * K) * Math.pow(T.height / 1.2, 1 - Math.log(0.33 / 0.062) / Math.log(50))).toFixed(1),
           bossFrameD: +(W.director.data.bossFrameD || 0).toFixed(1),
           telegraphs: tgs, points: pts.length, outside: outN,
           maxNdcTelegraph: +maxTg.toFixed(3), maxNdcBoss: +maxBoss.toFixed(3), topNdcY: +topY.toFixed(3),
           bodyFrac: +(100 * Math.abs(P(T.height) - P(0)) / 2).toFixed(1) };
}
"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--want", default="irongully:coneBreath,caisson4:boomSweep,irongully:pawSlam")
    ap.add_argument("--seconds", type=float, default=120)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--level", type=int, default=37)
    ap.add_argument("--out", required=True)
    ap.add_argument("--after", type=float, default=0, help="only capture after this many s of boss fight (skips the intro-walk widening hold)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    wants = [w.split(":") for w in args.want.split(",")]
    rep = []
    sess = Session(args, "bossframe")
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
            sess.cheat("level", args.level)
            time.sleep(2.5)
            sess.cheat("killAll")
            sess.cheat("boss")
            ph = PHASE.get(attack, 1)
            got = None
            t_end = time.time() + args.seconds
            while time.time() < t_end:
                if sess.screen() == "draft":
                    sess.press("Digit1")
                    time.sleep(0.4)
                    continue
                o = sess.safe_js(PROBE_JS, {"phase": ph}) or {}
                bo = o.get("boss") or {}
                tg = o.get("tg")
                if bo.get("attack") == attack and tg and 0.7 <= tg["frac"] <= 0.92 and (bo.get("fightT") or 0) >= args.after:
                    sess.bt_call("freeze", True)
                    time.sleep(0.8)
                    fr = sess.safe_js(FRAME_JS)
                    path = os.path.join(args.out, "%s_%s%s.png" % (boss, attack, "_after%d" % args.after if args.after else ""))
                    sess.screenshot(path)
                    got = {"boss": boss, "attack": attack, "png": path, "tg": tg, "frame": fr, "titan": o.get("titan")}
                    sess.bt_call("freeze", False)
                    break
                time.sleep(0.04)
            print(json.dumps(got or {"boss": boss, "attack": attack, "missed": True}), flush=True)
            rep.append(got or {"boss": boss, "attack": attack, "missed": True})
    finally:
        sess.close()
    with open(os.path.join(args.out, "bossframe.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
