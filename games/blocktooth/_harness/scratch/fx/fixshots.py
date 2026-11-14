#!/usr/bin/env python
"""fx fix-group verification captures. Output: _shots/fxfix/<name>.png + metrics.json

    python _harness/scratch/fx/fixshots.py --base http://localhost:5197/ --headless --only boss_c4,boss_ig,tabloid,hook

Word metric (sampled ~12 Hz during boss fights): live burst words, same-text duplicates on screen,
and the fraction of each word's screen rect that lies over the boss's projected bounds.
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (ROOT, Session, add_common_args, build_url, ensure_play, set_rank, world_to_keys)  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "fxfix")
LOG = []


def log(m):
    LOG.append(m)
    print(m, flush=True)


WORDS_JS = r"""
() => {
  const B = window.__BT__; const core = B && B.debugCore; if (!core) return null;
  const W = window.__H_W__ && window.__H_W__(); if (!W) return null;
  const cam = core.camera; const V = cam.position.constructor;
  const m = core.scene.getObjectByName('fx:words'); if (!m) return { n: -1 };
  const g = m.geometry; const n = m.visible ? g.instanceCount : 0;
  const P = g.getAttribute('aPos').array, S = g.getAttribute('aSize').array, U = g.getAttribute('aUV').array;
  const F = g.getAttribute('aFill').array;
  const cv = core.renderer.domElement; const Wd = cv.clientWidth, Ht = cv.clientHeight;
  const proj = (x, y, z) => { const v = new V(x, y, z).project(cam); return [(v.x * 0.5 + 0.5) * Wd, (-v.y * 0.5 + 0.5) * Ht, v.z]; };
  const right = new V().setFromMatrixColumn(cam.matrixWorld, 0), up = new V().setFromMatrixColumn(cam.matrixWorld, 1);
  let boss = null;
  if (W.boss && W.boss.alive) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of W.boss.parts) for (const yy of [p.y0, p.y1]) {
      const c = proj(p.x, yy, p.z); const e = proj(p.x + right.x * p.r, yy + right.y * p.r, p.z + right.z * p.r);
      const rr = Math.hypot(e[0] - c[0], e[1] - c[1]);
      x0 = Math.min(x0, c[0] - rr); x1 = Math.max(x1, c[0] + rr); y0 = Math.min(y0, c[1] - rr); y1 = Math.max(y1, c[1] + rr);
    }
    boss = [x0, y0, x1, y1];
  }
  const words = []; const cells = {}; let dup = 0; let overBoss = 0, maxOver = 0;
  for (let i = 0; i < n; i++) {
    if (F[i * 4 + 3] < 0.05) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], w = S[i * 3], h = S[i * 3 + 1];
    const c = proj(x, y, z);
    const r = proj(x + right.x * w / 2, y + right.y * w / 2, z + right.z * w / 2);
    const t = proj(x + up.x * h / 2, y + up.y * h / 2, z + up.z * h / 2);
    const hw = Math.hypot(r[0] - c[0], r[1] - c[1]), hh = Math.hypot(t[0] - c[0], t[1] - c[1]);
    const key = U[i * 4].toFixed(4) + ',' + U[i * 4 + 1].toFixed(4);
    if (cells[key]) dup++; cells[key] = 1;
    let frac = 0;
    if (boss) {
      const ow = Math.min(c[0] + hw, boss[2]) - Math.max(c[0] - hw, boss[0]);
      const oh = Math.min(c[1] + hh, boss[3]) - Math.max(c[1] - hh, boss[1]);
      frac = ow > 0 && oh > 0 ? (ow * oh) / (4 * hw * hh) : 0;
      overBoss += frac; maxOver = Math.max(maxOver, frac);
    }
    words.push({ x: Math.round(c[0]), y: Math.round(c[1]), w: Math.round(hw * 2), h: Math.round(hh * 2), a: +F[i * 4 + 3].toFixed(2), over: +frac.toFixed(2) });
  }
  return { n: words.length, dup, maxOver, boss: boss && boss.map(Math.round), rank: W.titan.rank, words, screenH: Ht };
}
"""

W_JS = r"""
() => { const W = window.__H_W__ && window.__H_W__(); if (!W) return null; const T = W.titan; const b = W.boss;
  const tgs = [];
  for (const tg of (W.telegraphs || [])) { if (!tg.alive || tg.fired) continue;
    tgs.push({ id: tg.id, owner: tg.owner, style: tg.style, tag: tg.tag || '', t: tg.t, windup: tg.windup }); }
  return { t: W.t, T: { x: T.x, z: T.z, h: T.height, r: T.radius, leash: T.leash ? T.leash.t : 0 },
    boss: b ? { id: b.id, x: b.x, z: b.z, hp: b.hp, maxHp: b.maxHp, phase: b.phase, attack: b.attack, introT: b.introT, alive: b.alive } : null,
    tgs };
}
"""


class C:
    def __init__(self, sess, args):
        self.s = sess
        self.a = args
        os.makedirs(OUT, exist_ok=True)
        self.metrics = {}

    def shot(self, name):
        p = os.path.join(OUT, name + ".png")
        ok = self.s.screenshot(p)
        wm = self.s.safe_js(WORDS_JS) or {}
        log("  [%s] %s words=%s dup=%s maxOverBoss=%s" % ("ok" if ok else "!!", name, wm.get("n"), wm.get("dup"), round(wm.get("maxOver") or 0, 2)))
        self.metrics.setdefault("shots", {})[name] = wm
        return ok

    def run(self, titan, biome, seed):
        s = self.s
        s.release_all()
        s.goto(build_url(self.a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed, noslate=1))
        s.wait_bt(90)
        s.wait_screen(("slate", "play", "draft"), 90)
        ensure_play(s, 10)

    def boss(self, titan, biome, tag, secs=110):
        log("== boss %s (%s / %s)" % (tag, titan, biome))
        s = self.s
        self.run(titan, biome, 304)
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(2.5)
        s.cheat("boss")
        t0 = time.time()
        intro = False
        got = set()
        phase_target, phase_t, mode_t, toward = 1, time.time(), time.time(), True
        samples = []
        live_shots = 0
        while time.time() - t0 < secs:
            scr = s.screen()
            if scr == "end":
                break
            if scr != "play":
                s.release_all()
                ensure_play(s, 10)
                continue
            o = s.safe_js(W_JS)
            if not o or not o.get("boss"):
                time.sleep(0.2)
                continue
            b, T = o["boss"], o["T"]
            wm = s.safe_js(WORDS_JS)
            if wm and wm.get("n", -1) >= 0:
                samples.append({"n": wm["n"], "dup": wm["dup"], "maxOver": wm["maxOver"]})
            if not intro and time.time() - t0 > 2.2:
                self.shot("%s_intro" % tag)
                intro = True
            if live_shots < 6 and time.time() - t0 > 8 + live_shots * 15:
                self.shot("%s_live_%d" % (tag, live_shots))
                live_shots += 1
            if time.time() - phase_t > 34 and phase_target < 3:
                phase_target += 1
                frac = 0.6 if phase_target == 2 else 0.3
                s.safe_js("(f) => { const b = window.__H_W__().boss; if (b.hp > b.maxHp * f) b.hp = b.maxHp * f; }", frac)
                phase_t = time.time()
            if time.time() - mode_t > 5.0:
                toward = not toward
                mode_t = time.time()
            dx, dz = b["x"] - T["x"], b["z"] - T["z"]
            d = math.hypot(dx, dz) or 1
            if not toward:
                dx, dz = -dx, -dz
            elif d < 70:
                dx, dz = -dz, dx
            s.hold(world_to_keys(dx, dz) or {"KeyW"})
            for tg in o["tgs"]:
                if tg["owner"] != "boss" or not tg["windup"]:
                    continue
                key = "P%d_%s" % (b["phase"], b["attack"] or tg["tag"])
                fr = tg["t"] / tg["windup"]
                if key not in got and 0.4 <= fr <= 0.8 and b["introT"] <= 0:
                    s.release_all()
                    s.bt_call("freeze", True)
                    time.sleep(0.35)
                    self.shot("%s_%s" % (tag, key))
                    s.bt_call("freeze", False)
                    got.add(key)
                    break
            time.sleep(0.07)
        s.release_all()
        n = [x["n"] for x in samples]
        self.metrics[tag] = {
            "samples": len(samples),
            "maxWords": max(n) if n else None,
            "meanWords": round(sum(n) / len(n), 2) if n else None,
            "samplesWithDup": sum(1 for x in samples if x["dup"] > 0),
            "samplesWordOverBoss50": sum(1 for x in samples if x["maxOver"] >= 0.5),
            "samplesWordOverBossAny": sum(1 for x in samples if x["maxOver"] > 0.05),
            "attacks": sorted(got),
        }
        log("    metrics %s" % json.dumps(self.metrics[tag]))

    def tabloid(self):
        s = self.s
        log("== tabloid dead (hearthback / lockwater)")
        self.run("hearthback", "lockwater", 308)
        s.cheat("god", False)
        set_rank(s, 1, log)
        time.sleep(2)
        s.cheat("spawn", "tank", 8)
        s.cheat("spawn", "walker", 3)
        t0 = time.time()
        while time.time() - t0 < 50:
            scr = s.screen()
            if scr == "end":
                break
            if scr == "draft":
                s.press("Digit1")
                time.sleep(0.5)
                continue
            s.safe_js("() => { const T = window.__H_W__().titan; if (T.hp > 5) T.hp = 5; }")
            time.sleep(0.4)
        if s.screen() != "end":
            s.safe_js("() => { const T = window.__H_W__().titan; T.hp = 0; T.alive = false; }")
        s.wait_screen("end", 20)
        time.sleep(4.0)
        self.shot("tabloid_dead")

    def hook(self):
        s = self.s
        for titan in ("molo", "briarwick"):
            log("== hook word %s" % titan)
            self.run(titan, "grideast", 311)
            s.cheat("god", True)
            s.cheat("noSpawns", True)
            set_rank(s, 1, log)
            time.sleep(2.0)
            s.hold({"KeyW"})
            time.sleep(0.6)
            s.release_all()
            s.press("Space")
            time.sleep(0.25)
            s.bt_call("freeze", True)
            time.sleep(0.3)
            self.shot("hook_%s" % titan)
            s.bt_call("freeze", False)


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="boss_c4,boss_ig,tabloid,hook")
    ap.add_argument("--secs", type=float, default=110)
    a = ap.parse_args()
    a.no_serve = True
    sess = Session(a, "fxfix")
    sess.start()
    c = C(sess, a)
    try:
        for part in a.only.split(","):
            try:
                if part == "boss_c4":
                    c.boss("hearthback", "grideast", "c4ge", a.secs)
                elif part == "boss_c4lw":
                    c.boss("molo", "lockwater", "c4lw", a.secs)
                elif part == "boss_igbw":
                    c.boss("briarwick", "whitestacks", "igbw", a.secs)
                elif part == "boss_ig":
                    c.boss("hearthback", "whitestacks", "igws", a.secs)
                else:
                    getattr(c, part)()
            except Exception as e:
                log("!! %s failed: %s" % (part, str(e).splitlines()[0][:300]))
                sess.release_all()
    finally:
        d = sess.diagnostics()
        sess.close()
        with open(os.path.join(OUT, "metrics_%s.json" % a.only.replace(",", "_")[:60]), "w") as f:
            json.dump({"metrics": c.metrics, "diag": {k: d.get(k) for k in ("consoleErrors", "pageErrors")}, "log": LOG}, f, indent=1, default=str)
        print("diag errors:", len(d.get("consoleErrors", []) or []), len(d.get("pageErrors", []) or []))
        for e in (d.get("consoleErrors", []) or [])[:5]:
            print("  console:", str(e)[:300])
        for e in (d.get("pageErrors", []) or [])[:5]:
            print("  page:", str(e)[:300])


if __name__ == "__main__":
    main()
