#!/usr/bin/env python
"""BOSS-FRAME PUMP LOG — real headed Chrome, a live boss fight at the default zoom (1x, never touched):
logs the camera distance every 100 ms for --window s per phase and, on EVERY rendered frame, projects
every live boss telegraph point (+ the boss rig) through the LIVE camera (the drawn view: lead, offset,
punch and shake included). A point is OUT when max(|ndc x|, |ndc y|) > 1.

    python _harness/scratch/view/framepump.py --base http://localhost:5391/ --boss parkade6 \
        --out _shots/framepump/before [--level 37] [--titan molo] [--window 30] [--phases 1,2]

The window and the 100 ms buckets are GAME time (World.t): on a GPU-starved box the page runs at a
few fps and the loop clamps each frame to 0.1 s, so wall time would under-sample the fight.
Pump metrics on the 100 ms autoDist series (the rig's spring distance, zoom/punch excluded):
  legs      zigzag legs with a >= 2 % turn threshold (a leg = a monotone run between turns)
  pumps     shrink legs >= 3 % that are followed by a widen leg >= 3 % (in-out-in = one pump)
  tv/range  total variation / (max - min) — 1.0 = one monotone move, >> 1 = see-sawing
The titan walks a real-key square (W, D, S, A for --leg s each) so the boss chases and turns; god +
noSpawns keep the fight going. Sampling starts once the boss intro walk is over (introT <= 0) + 3 s.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, BIOME_BOSS  # noqa: E402

BOSS_BIOME = {v: k for k, v in BIOME_BOSS.items()}

SAMPLER_JS = r"""
(opts) => {
  const S = window.__FP__ = { on: true, rows: [], frames: 0, framesOut: 0, ptsOut: 0, ptsTot: 0, worst: null, tgFrames: 0 };
  const c = window.__BTCAM__, cam = c.camera, V = cam.position.constructor, v = new V();
  let bucketT = null, bk = null;
  const N = 16;
  const newBk = () => ({ frames: 0, out: 0, maxTg: 0, maxBoss: 0, tgs: new Set() });
  bk = newBk();
  const proj = (x, y, z) => { v.set(x, y, z).project(cam); return Math.max(Math.abs(v.x), Math.abs(v.y)); };
  const tick = () => {
    if (!S.on) return;
    requestAnimationFrame(tick);
    const W = window.__H_W__ && window.__H_W__();
    if (!W || !W.titan) return;
    const b = W.boss;
    let out = 0, maxTg = 0, maxBoss = 0, tot = 0, anyTg = false;
    const tgPt = (x, z, tag) => { const m = proj(x, 0, z); tot++; if (m > maxTg) maxTg = m; if (m > 1) { out++; if (!S.worst || m > S.worst.m) S.worst = { m: +m.toFixed(3), tag, t: W.t }; } };
    for (const tg of (W.telegraphs || [])) {
      if (!tg.alive || tg.owner !== 'boss') continue;
      anyTg = true; bk.tgs.add(tg.tag);
      const s = tg.shape;
      if (s.k === 'circle' || s.k === 'ring') { const r = s.k === 'circle' ? s.r : s.r1; for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; tgPt(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, tg.tag); } }
      else if (s.k === 'cone') { tgPt(s.x, s.z, tg.tag); for (let i = 0; i <= N; i++) { const a = s.dir - s.half + 2 * s.half * i / N; tgPt(s.x + Math.sin(a) * s.r, s.z + Math.cos(a) * s.r, tg.tag); } }
      else if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir), h = s.w / 2; for (const t of [0, s.len / 2, s.len]) for (const sg of [-1, 1]) tgPt(s.x + fx * t + fz * h * sg, s.z + fz * t - fx * h * sg, tg.tag); }
      else if (s.k === 'oval') { const fx = Math.sin(s.rot), fz = Math.cos(s.rot); for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI, lx = Math.sin(a) * s.rx, lz = Math.cos(a) * s.rz; tgPt(s.x + lx * fz + lz * fx, s.z - lx * fx + lz * fz, tg.tag); } }
      else if (s.k === 'capsule') { for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; tgPt(s.x0 + Math.sin(a) * s.r, s.z0 + Math.cos(a) * s.r, tg.tag); tgPt(s.x1 + Math.sin(a) * s.r, s.z1 + Math.cos(a) * s.r, tg.tag); } }
    }
    if (b && b.alive) for (const p of b.parts) {
      for (const [x, y, z] of [[p.x + p.r, 0, p.z], [p.x - p.r, 0, p.z], [p.x, 0, p.z + p.r], [p.x, 0, p.z - p.r], [p.x, p.y1, p.z]]) { const m = proj(x, y, z); if (m > maxBoss) maxBoss = m; }
    }
    S.frames++; S.ptsTot += tot; S.ptsOut += out; if (out > 0) S.framesOut++; if (anyTg) S.tgFrames++;
    bk.frames++; bk.out += out; if (maxTg > bk.maxTg) bk.maxTg = maxTg; if (maxBoss > bk.maxBoss) bk.maxBoss = maxBoss;
    const now = performance.now();
    if (bucketT === null) { bucketT = W.t; S.t0 = W.t; }
    S.simT = W.t - S.t0;
    if (W.t - bucketT >= 0.1 - 1e-6) {
      bucketT += 0.1 * Math.floor((W.t - bucketT) / 0.1 + 1e-6);
      S.rows.push({ ms: Math.round(now), t: +W.t.toFixed(2), D: +c.distance.toFixed(2), auto: +c.autoDist.toFixed(2), zoom: +c.zoom.toFixed(3),
        bfd: +(W.director.data.bossFrameD || 0).toFixed(2), floor: +((c.bossFloor || 0)).toFixed(2), aspect: +cam.aspect.toFixed(3), attack: b ? b.attack : null, phase: b ? b.phase : 0,
        frames: bk.frames, out: bk.out, maxTg: +bk.maxTg.toFixed(3), maxBoss: +bk.maxBoss.toFixed(3), tgs: [...bk.tgs] });
      bk = newBk();
    }
  };
  requestAnimationFrame(tick);
  return true;
}
"""

STATE_JS = r"""
() => { const W = window.__H_W__ && window.__H_W__(); if (!W || !W.boss) return null; const b = W.boss;
  return { alive: b.alive, introT: b.introT, phase: b.phase, hp: b.hp, maxHp: b.maxHp, fightT: (b.data && b.data.fightT) || 0, attack: b.attack }; }
"""

FORCE_PHASE_JS = r"""
(ph) => { const W = window.__H_W__(); const b = W && W.boss; if (!b || !b.alive) return null;
  const f = ph === 2 ? 0.6 : ph === 3 ? 0.3 : 1; if (f < 1 && b.hp > b.maxHp * f) b.hp = b.maxHp * f; return b.phase; }
"""


def pump_metrics(rows, key="auto"):
    xs = [r[key] for r in rows if r.get(key)]
    if len(xs) < 3:
        return {}
    mean = sum(xs) / len(xs)
    thr = 0.02 * mean
    # zigzag legs (a turn = a retrace >= thr from the running extreme)
    legs = []                    # (dir, from, to)
    piv = ext = xs[0]; d = 0
    for x in xs[1:]:
        if d == 0:
            if x - piv >= thr: d = 1; ext = x
            elif piv - x >= thr: d = -1; ext = x
        elif d == 1:
            if x > ext: ext = x
            elif ext - x >= thr: legs.append((1, piv, ext)); piv = ext; ext = x; d = -1
        else:
            if x < ext: ext = x
            elif x - ext >= thr: legs.append((-1, piv, ext)); piv = ext; ext = x; d = 1
    if d != 0:
        legs.append((d, piv, ext))
    pumps = 0
    for i in range(len(legs) - 1):
        a, b = legs[i], legs[i + 1]
        if a[0] == -1 and b[0] == 1 and (a[1] - a[2]) >= 0.03 * a[1] and (b[2] - b[1]) >= 0.03 * b[1]:
            pumps += 1
    tv = sum(abs(xs[i + 1] - xs[i]) for i in range(len(xs) - 1))
    rng = max(xs) - min(xs)
    return {"n": len(xs), "min": round(min(xs), 1), "max": round(max(xs), 1), "mean": round(mean, 1),
            "legs": len(legs), "pumps": pumps, "tv": round(tv, 1), "range": round(rng, 1),
            "tv_over_range": round(tv / rng, 2) if rng > 1e-6 else 1.0,
            "leg_list": [(dd, round(s, 1), round(e, 1)) for dd, s, e in legs]}


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--boss", default="parkade6", choices=sorted(BOSS_BIOME))
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--level", type=int, default=37)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--window", type=float, default=30)
    ap.add_argument("--phases", default="1,2")
    ap.add_argument("--leg", type=float, default=2.5, help="seconds per side of the walked square")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    rep = {"boss": args.boss, "titan": args.titan, "level": args.level, "seed": args.seed, "window_s": args.window, "phases": []}
    sess = Session(args, "framepump")
    sess.start()
    try:
        url = build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=BOSS_BIOME[args.boss], seed=args.seed, noslate=1)
        sess.goto(url)
        sess.wait_bt(90)
        ok, scr = sess.wait_screen(("play",), 90)
        print("run", args.boss, ok, scr, flush=True)
        sess.cheat("god", True)
        sess.cheat("noSpawns", True)
        sess.cheat("level", args.level)
        time.sleep(2.5)
        for _ in range(40):                      # clear the level-up drafts
            if sess.screen() == "draft":
                sess.press("Digit1"); time.sleep(0.4)
            else:
                break
        sess.cheat("killAll")
        print("boss", sess.cheat("boss"), flush=True)
        t_end = time.time() + 90
        while time.time() < t_end:               # wait out the intro walk + 3 s
            st = sess.safe_js(STATE_JS) or {}
            if st.get("alive") and st.get("introT", 1) <= 0 and st.get("fightT", 0) >= 3:
                break
            if sess.screen() == "draft":
                sess.press("Digit1")
            time.sleep(0.2)
        keys = [["KeyW"], ["KeyD"], ["KeyS"], ["KeyA"]]
        for ph in [int(p) for p in args.phases.split(",") if p.strip()]:
            if ph > 1:
                sess.safe_js(FORCE_PHASE_JS, ph)
                time.sleep(3.0)                  # let the phase transition play
            sess.safe_js(SAMPLER_JS, {})
            t0 = time.time(); k = 0; t_leg = 0.0
            sess.hold(keys[0])
            while time.time() - t0 < args.window * 12:
                simT = sess.safe_js("() => (window.__FP__ && window.__FP__.simT) || 0") or 0
                if simT >= args.window:
                    break
                if sess.screen() == "draft":
                    sess.release_all(); sess.press("Digit1"); time.sleep(0.3); sess.hold(keys[k % 4])
                if simT - t_leg >= args.leg:
                    k += 1; t_leg = simT; sess.hold(keys[k % 4])
                time.sleep(0.05)
            sess.release_all()
            wall = time.time() - t0
            S = sess.safe_js("() => { const S = window.__FP__; S.on = false; return { simT: S.simT, rows: S.rows, frames: S.frames, framesOut: S.framesOut, ptsOut: S.ptsOut, ptsTot: S.ptsTot, worst: S.worst, tgFrames: S.tgFrames }; }") or {}
            rows = S.get("rows", [])
            st = sess.safe_js(STATE_JS) or {}
            pm = pump_metrics(rows, "auto")
            pmD = pump_metrics(rows, "D")
            ph_rep = {"phase_forced": ph, "sim_s": round(S.get("simT") or 0, 2), "wall_s": round(wall, 1),
                      "fps_wall": round((S.get("frames") or 0) / max(1e-6, wall), 1), "boss_state_end": st, "frames": S.get("frames"), "tell_frames": S.get("tgFrames"),
                      "frames_with_tell_out": S.get("framesOut"), "tell_points_out": S.get("ptsOut"), "tell_points_total": S.get("ptsTot"),
                      "worst_out": S.get("worst"), "max_ndc_tell": max([r["maxTg"] for r in rows] or [0]),
                      "max_ndc_boss": max([r["maxBoss"] for r in rows] or [0]),
                      "pump_auto": {k2: v for k2, v in pm.items() if k2 != "leg_list"}, "legs_auto": pm.get("leg_list"),
                      "pump_D": {k2: v for k2, v in pmD.items() if k2 != "leg_list"},
                      "attacks": sorted({t for r in rows for t in r["tgs"]}), "rows": rows}
            rep["phases"].append(ph_rep)
            shot = os.path.join(args.out, "%s_p%d.png" % (args.boss, ph))
            sess.screenshot(shot)
            ph_rep["png"] = shot
            print(json.dumps({k2: v for k2, v in ph_rep.items() if k2 not in ("rows",)}), flush=True)
        rep["diag_errors"] = sess.window_errors()
    finally:
        sess.close()
    with open(os.path.join(args.out, "framepump_%s.json" % args.boss), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
