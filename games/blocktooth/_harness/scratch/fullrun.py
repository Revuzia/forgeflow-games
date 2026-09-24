#!/usr/bin/env python
"""BLOCKTOOTH play-critic full run — title screen → tabloid with REAL keys only (page.keyboard).

    python _harness/scratch/fullrun.py --base http://localhost:5192/ --titan voltkite --biome lockwater

__BT__ is read for OBSERVATION only (state(), world). No cheats, no step(), no ?dev=1.
Human-like policy: hostile telegraphs are ignored until they have been on screen for --react s
(default 0.25 s, a human reaction time), then the policy steps out of the paint (dash if < 0.45 s left).
Food seeking = playtest.py policy. Boss: approach to the titan's reach, then strafe.
Records: time to each Size (sim s), levels, drafts, hp dips, per-telegraph hit/dodge, boss phases +
attacks seen, run result. Writes _harness/_reports/fullrun_<titan>_<biome>.json.
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import (Session, add_common_args, build_url, dismiss_slate, menus_to_slate, owned_total,  # noqa: E402
                    save_report, world_to_keys, diag_problems, print_diagnostics, SHOTS)
from playtest import OBS_JS, handle_draft  # noqa: E402

# human reaction gate on hostile paint
OBS = OBS_JS.replace(
    "if (!tg.alive || tg.owner === 'titan') continue;",
    "if (!tg.alive || tg.owner === 'titan') continue;"
    " { const M = (window.__FR_SEEN__ = window.__FR_SEEN__ || new Map()); if (!M.has(tg.id)) M.set(tg.id, performance.now());"
    "   if (performance.now() - M.get(tg.id) < (p.react || 0) * 1000) continue; }")
assert OBS != OBS_JS
OBS = OBS.replace(
    "if (W.boss && W.boss.alive) out.boss = { x: W.boss.x, z: W.boss.z, introT: W.boss.introT };",
    "if (W.boss && W.boss.alive) out.boss = { x: W.boss.x, z: W.boss.z, introT: W.boss.introT, phase: W.boss.phase,"
    " hp: W.boss.hp, maxHp: W.boss.maxHp, attack: W.boss.attack, meter: W.boss.meter, stagger: W.boss.staggerT };")

# page-side tracker (rAF): every hostile telegraph (tag/style/windup/hit), boss attacks, hp dips
TRACK_JS = r"""
(() => {
  if (window.__FR__) return;
  const FR = window.__FR__ = { tg: [], open: new Map(), bossAtk: [], lastAtk: null, minHpF: 1, dips: 0, armed: true, hurt: 0 };
  const loop = () => {
    try {
      const B = window.__BT__; const W = B && B.world;
      if (W && W.titan) {
        for (const tg of (W.telegraphs || [])) {
          if (tg.owner === 'titan' || FR.open.has(tg)) continue;
          FR.open.set(tg, { t0: W.t });
        }
        for (const [tg, o] of FR.open) {
          if (!tg.alive || tg.fired && tg.active <= 0) {
            if (tg.fired) FR.tg.push({ tag: tg.tag, style: tg.style, owner: tg.owner, windup: +tg.windup.toFixed(2), hit: !!tg.hitTitan, t: +o.t0.toFixed(1), dmg: Math.round(tg.dmg) });
            FR.open.delete(tg);
          }
        }
        const T = W.titan; const f = T.maxHp > 0 ? T.hp / T.maxHp : 1;
        if (f < FR.minHpF) FR.minHpF = f;
        if (FR.armed && f < 0.3) { FR.dips++; FR.armed = false; } else if (f > 0.55) FR.armed = true;
        const C = B.debugCore && B.debugCore.camera;
        if (C) {
          const now = performance.now();
          if (!FR.camLast || now - FR.camLast > 250) {
            FR.camLast = now; FR.cam = FR.cam || [];
            const dx = C.position.x - T.x, dy = C.position.y, dz = C.position.z - T.z;
            FR.cam.push([+W.t.toFixed(2), W.titan.rank, +Math.hypot(dx, dy, dz).toFixed(2), +T.height.toFixed(2), +T.speed.toFixed(2)]);
          }
        }
        const b = W.boss;
        if (b && b.alive && b.attack && b.attack !== FR.lastAtk) FR.bossAtk.push({ a: b.attack, t: +W.t.toFixed(1), ph: b.phase });
        FR.lastAtk = b ? b.attack : null;
      }
    } catch (e) { FR.err = String(e); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
"""

REACH = {"molo": 0.75, "voltkite": 2.6, "hearthback": 2.0, "briarwick": 2.1}   # engage distance in H


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="voltkite")
    ap.add_argument("--biome", default="lockwater")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--max-seconds", type=float, default=1000.0)
    ap.add_argument("--react", type=float, default=0.25)
    ap.add_argument("--tag", default="")
    ap.add_argument("--observe-dev", action="store_true", help="?dev=1 ONLY to read the camera (debugCore); no cheats are called")
    args = ap.parse_args()
    tag = "%s_%s%s" % (args.titan, args.biome, args.tag)
    shot_dir = os.path.join(SHOTS, "critic", tag)
    os.makedirs(shot_dir, exist_ok=True)
    log_lines = []

    def log(msg):
        line = "[%7.1f] %s" % (time.time() - T0, msg)
        log_lines.append(line)
        print(line, flush=True)

    T0 = time.time()
    rep = {"titan": args.titan, "biome": args.biome, "react": args.react}
    sess = Session(args, "fullrun")
    sess.start()
    sess.page.add_init_script(TRACK_JS)
    from flows import AUDIO_JS
    sess.page.add_init_script(AUDIO_JS)
    audio_log = []
    m = {"draftsTaken": 0, "draftsFailed": 0, "rankT": {}, "levelT": {}, "hpLost": 0.0, "pauses": 0,
         "spacePresses": 0, "shiftPresses": 0, "stuck": 0, "bossPhases": {}, "moved": 0.0}
    shots = []
    try:
        url = build_url(args.base, seed=args.seed, quality=args.quality, dev=1) if args.observe_dev else build_url(args.base, seed=args.seed, quality=args.quality)
        log("open " + url)
        sess.goto(url)
        sess.wait_bt(60)
        ok, nav = menus_to_slate(sess, args.titan, args.biome, log=log)
        rep["menus"] = nav
        log("menus %s" % ok)
        if not ok:
            raise RuntimeError("menus failed: %s" % nav)
        time.sleep(1.0)
        ok, scr = dismiss_slate(sess, 20, "Space")
        log("slate dismissed with Space: %s (%s)" % (ok, scr))
        sess.release_all()
        s0 = sess.state() or {}
        rep["seed"] = s0.get("seed")
        t_real0 = time.time()
        last_space = last_shift = 0.0
        banned = []
        detour_until = 0.0
        detour = (0.0, 0.0)
        prog_pos, prog_t = None, time.time()
        draft_i = 0
        prev = None
        last_rank = 0
        last_level = 1
        next_shot = time.time() + 5
        shot_n = 0
        last_log = 0
        while time.time() - t_real0 < args.max_seconds:
            now = time.time()
            banned = [b for b in banned if b[2] > now]
            obs = sess.safe_js(OBS, {"banned": [[b[0], b[1]] for b in banned], "react": args.react})
            s = (obs or {}).get("s") if isinstance(obs, dict) else None
            if not isinstance(s, dict):
                time.sleep(0.1)
                continue
            scr = s.get("screen")
            st = s.get("t") or 0
            r = int(s.get("rank") or 0)
            if r > last_rank:
                for k in range(last_rank + 1, r + 1):
                    m["rankT"][k] = round(st, 1)
                log("SIZE %d at sim %.1f s (LV %s, drafts %d)" % (r + 1, st, s.get("level"), m["draftsTaken"]))
                last_rank = r
                p = os.path.join(shot_dir, "rank%d.png" % (r + 1))
                time.sleep(0.4)
                if sess.screenshot(p):
                    shots.append(p)
            lv = int(s.get("level") or 1)
            if lv > last_level:
                for k in range(last_level + 1, lv + 1):
                    m["levelT"][k] = round(st, 1)
                last_level = lv
            b = obs.get("boss")
            if b and b.get("phase") and str(b["phase"]) not in m["bossPhases"]:
                m["bossPhases"][str(b["phase"])] = round(st, 1)
                log("BOSS phase %s at sim %.1f s (hp %.0f/%.0f)" % (b["phase"], st, b.get("hp", 0), b.get("maxHp", 0)))
                p = os.path.join(shot_dir, "boss_p%s.png" % b["phase"])
                if sess.screenshot(p):
                    shots.append(p)
            x, z = s.get("x"), s.get("z")
            if isinstance(x, (int, float)) and prev:
                d = math.hypot(x - prev[0], z - prev[1])
                if d < 300:
                    m["moved"] += d
            if isinstance(x, (int, float)):
                prev = (x, z)
            if now - last_log > 30:
                last_log = now
                au = sess.safe_js("() => { const A = window.__AU__; if (!A || !A.ctx) return null; A.tap(); const r = A.rms(); return { state: A.ctx.state, music: r.music && r.music.rms, sfx: r.sfx && r.sfx.rms, master: r.master && r.master.rms }; }")
                ed = sess.safe_js("() => { const W = window.__H_W__ && window.__H_W__(); if (!W) return null; const T = W.titan; let n = 0, nd = 1e9, tiers = [0,0,0,0,0], big = 0;"
                                  " for (const b of W.city.buildings) { if (b.collapsed || !(b.alive > 0)) continue; if (b.tier <= T.rank) { n++; tiers[b.tier]++; nd = Math.min(nd, Math.hypot(b.x - T.x, b.z - T.z)); } else big++; }"
                                  " let pk = 0; for (const q of (W.pickups || [])) if (q.alive) pk++; return { edible: n, nearest: Math.round(nd), tiers, oversize: big, pickups: pk, H: +T.height.toFixed(1), xp: T.xp, mass: Math.round(T.mass || 0) }; }")
                log("   food: %s" % json.dumps(ed))
                audio_log.append({"t": round(st, 1), "screen": scr, "boss": bool(b), **(au or {})})
                log("sim %.0f s · screen %s · Size %d · LV %s · hp %.0f/%.0f · enemies %s · kills %s · drafts %d%s" % (
                    st, scr, r + 1, s.get("level"), s.get("hp") or 0, s.get("maxHp") or 0, s.get("enemies"), s.get("kills"),
                    m["draftsTaken"], (" · boss ph%s %.0f%%" % (b.get("phase"), 100 * b["hp"] / max(1, b["maxHp"]))) if b else ""))
            if now >= next_shot and scr == "play":
                p = os.path.join(shot_dir, "t%02d.png" % shot_n)
                if sess.screenshot(p):
                    shots.append(p)
                shot_n += 1
                next_shot = now + 45
            if scr == "end":
                sess.release_all()
                log("RUN END: %s" % json.dumps(s.get("run"))[:300])
                break
            if scr == "pause":
                sess.release_all()
                m["pauses"] += 1
                log("unexpected pause — Escape")
                sess.press("Escape")
                time.sleep(0.6)
                continue
            drafts = s.get("drafts") or {}
            if scr == "draft" or (scr != "play" and drafts.get("offer")):
                draft_i = handle_draft(sess, s, m, draft_i, lambda *_: None)
                continue
            if scr != "play":
                sess.release_all()
                time.sleep(0.15)
                continue
            T = obs.get("t") or {}
            tx, tz = T.get("x", x), T.get("z", z)
            H = T.get("height") or 1.2
            threat = obs.get("threat")
            dx = dz = 0.0
            if threat:
                dx, dz = threat["dx"], threat["dz"]
            elif now < detour_until:
                dx, dz = detour
            elif b and (b.get("introT") or 0) <= 0:
                bx, bz = b["x"] - tx, b["z"] - tz
                d = math.hypot(bx, bz) or 1.0
                want = REACH.get(args.titan, 1.5) * H + 18
                if d > want * 1.15:
                    dx, dz = bx / d, bz / d
                elif d < want * 0.7:
                    dx, dz = -bx / d + 0.6 * (-bz / d), -bz / d + 0.6 * (bx / d)
                else:
                    dx, dz = -bz / d + 0.25 * bx / d, bx / d + 0.25 * bz / d
            elif obs.get("food"):
                f = obs["food"]
                dx, dz = f["x"] - tx, f["z"] - tz
            else:
                a = (now - t_real0) * 0.35
                dx, dz = math.sin(a), math.cos(a)
            bd = obs.get("bounds")
            if bd and isinstance(tx, (int, float)):
                edge = max(4.0, 2 * H)
                if tx < bd["minX"] + edge: dx = abs(dx) + 0.5
                if tx > bd["maxX"] - edge: dx = -abs(dx) - 0.5
                if tz < bd["minZ"] + edge: dz = abs(dz) + 0.5
                if tz > bd["maxZ"] - edge: dz = -abs(dz) - 0.5
            keys = world_to_keys(dx, dz) or {"KeyW"}
            sess.hold(keys)
            if prog_pos is None:
                prog_pos, prog_t = (x, z), now
            elif now - prog_t >= 1.5:
                if isinstance(x, (int, float)) and math.hypot(x - prog_pos[0], z - prog_pos[1]) < max(1.0, 0.4 * H) and not threat:
                    m["stuck"] += 1
                    mag = math.hypot(dx, dz) or 1.0
                    sg = 1 if m["stuck"] % 2 else -1
                    detour = (-dz / mag * sg, dx / mag * sg)
                    detour_until = now + 1.0
                    if obs.get("food"):
                        banned.append((obs["food"]["x"], obs["food"]["z"], now + 12))
                prog_pos, prog_t = (x, z), now
            cd = T.get("abilityCd")
            # hook use: MOLO vacuum when pickups around; VOLT-KITE detonate right after a dash; others on cd
            if cd is not None and cd <= 0 and now - last_space > 1.0:
                if args.titan != "voltkite" or now - last_shift < 1.2:
                    sess.press("Space")
                    m["spacePresses"] += 1
                    last_space = now
            charges = T.get("dashCharges")
            urgent = bool(threat) and threat.get("tLeft", 9) < 0.45
            periodic = now - last_shift > (2.5 if args.titan == "voltkite" else 6.0)
            if (urgent or periodic) and (charges is None or charges >= 1) and now - last_shift > 0.35:
                sess.press("Shift")
                m["shiftPresses"] += 1
                last_shift = now
            dt = time.time() - now
            if dt < 0.1:
                time.sleep(0.1 - dt)
        sess.release_all()
        final = sess.state() or {}
        rep["final"] = {k: final.get(k) for k in ("screen", "t", "rank", "level", "hp", "maxHp", "kills", "crushed", "floorsEaten",
                                                  "buildingsLeveled", "propsEaten", "run", "boss")}
        fr = sess.safe_js("() => { const F = window.__FR__; return F ? { tg: F.tg, bossAtk: F.bossAtk, minHpF: F.minHpF, dips: F.dips, err: F.err, cam: F.cam || [] } : null }")
        rep["tracker"] = fr
        if final.get("screen") == "end":
            time.sleep(4)
            p = os.path.join(shot_dir, "tabloid.png")
            if sess.screenshot(p):
                shots.append(p)
        rep["events"] = sess.event_counts()
    except Exception as e:
        rep["fatal"] = str(e)[:500]
        log("FATAL " + str(e)[:300])
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()
    rep["metrics"] = m
    rep["audio"] = audio_log
    rep["shots"] = shots
    rep["diag"] = diag
    rep["diagProblems"] = diag_problems(diag)
    rep["log"] = log_lines
    rep["realSeconds"] = round(time.time() - T0, 1)
    # summary of telegraph outcomes
    tg = (rep.get("tracker") or {}).get("tg") or []
    by = {}
    for t in tg:
        k = "%s/%s" % (t["owner"], t["tag"] or t["style"])
        a = by.setdefault(k, [0, 0, t["windup"]])
        a[0] += 1
        a[1] += 1 if t["hit"] else 0
    rep["telegraphSummary"] = {k: {"n": v[0], "hit": v[1], "windup": v[2]} for k, v in sorted(by.items())}
    print(json.dumps({k: rep.get(k) for k in ("final", "metrics", "telegraphSummary")}, indent=1, default=str)[:6000])
    print_diagnostics(diag, 10)
    save_report("fullrun_" + tag, rep, args.base)


if __name__ == "__main__":
    main()
