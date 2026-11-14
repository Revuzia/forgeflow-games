#!/usr/bin/env python
"""Measure the hero's RUN CYCLE numerically — no screenshots.

Drives hero.update() at a fixed 1/60 s with grounded=true and vel=(9,0,0) for
one second and records, every step, the run-cycle phase and the BLENDED hip /
shoulder rotations that come out the other side of the spring blend + IK.

The question it answers: at TUNE.speedRun does Nim's stride actually swing, and
by how many degrees?  A screenshot can only say "looks like standing".

    python runcycleprobe.py [--course verdant-1] [--speed 9]
"""
import argparse
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

CLICK_JS = r"""() => {
  const words = ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(w) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return w;
  }
  const t = document.querySelector('canvas') || document;
  for (const ty of ['keydown','keyup'])
    t.dispatchEvent(new KeyboardEvent(ty,{code:'Enter',key:'Enter',bubbles:true,cancelable:true}));
  return null;
}"""

PROBE_JS = r"""
(o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const hero = G.hero, P = G.player;
  if (!hero || !P) return {error: 'no hero/player'};

  // freeze the game's own drivers; we call hero.update ourselves
  P.update = function () {};
  if (G.cam) G.cam.update = function () {};
  G._checkDeath = function () {};

  const p0 = P.pos.clone();
  const write = (anim, grounded, vx, t) => {
    P.pos.copy(p0); P.prevPos.copy(p0); P.renderPos.copy(p0);
    P.vel.set(vx, 0, 0);
    P.facing = 0; P.grounded = grounded; P.onGround = grounded;
    P.state = anim; P.anim = anim; P.stateT = t; P.animT = t;
    P.speed = Math.abs(vx); P.speedNorm = Math.min(1, Math.abs(vx) / 9);
    P.leanX = 0; P.dead = false; P.heroFade = 0; P.inWater = null;
    P.wallN = null; P.crouching = false; P.sliding = false;
  };

  const D = 1 / 60;
  // settle standing first
  for (let k = 0; k < 60; k++) { write('idle', true, 0, k * D); hero.update(D, P); }

  const rows = [];
  const N = Math.round(o.seconds / D);
  for (let k = 0; k < N; k++) {
    write('run', true, o.speed, k * D);
    hero.update(D, P);
    const b = hero.bones;
    rows.push({
      t: +(k * D).toFixed(3),
      phase: +hero._phase.toFixed(3),
      dist: +hero._dist.toFixed(2),
      speed: +hero._speed.toFixed(2),
      ulR: +b.upperLegR.rotation.x.toFixed(4),
      ulL: +b.upperLegL.rotation.x.toFixed(4),
      llR: +b.lowerLegR.rotation.x.toFixed(4),
      uaR: +b.upperArmR.rotation.x.toFixed(4),
      uaL: +b.upperArmL.rotation.x.toFixed(4),
      rigPitch: +hero.rig.rotation.x.toFixed(4),
      rigY: +hero.rig.position.y.toFixed(4),
      ikW: +hero._ikW.toFixed(3),
      sqY: +hero._squash.toFixed(3),
      // the scarf tip, relative to its collar anchor, in world metres
      scarfDx: +(hero._scarfP[21] - hero._scarfP[0]).toFixed(3),
      scarfDy: +(hero._scarfP[22] - hero._scarfP[1]).toFixed(3),
      scarfDz: +(hero._scarfP[23] - hero._scarfP[2]).toFixed(3),
    });
  }
  return {rows, stride: 1.90,
          tune: {speedRun: 9, boneLambda: 14},
          proportions: {hipY: hero.constructor.name}};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--speed", type=float, default=9.0)
    ap.add_argument("--seconds", type=float, default=1.0)
    a = ap.parse_args()

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 480, "height": 320})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto("%s?dev=1&course=%s" % (BASE, a.course), wait_until="load", timeout=60_000)
        dl = time.time() + 90
        ok = False
        while time.time() < dl:
            try:
                if pg.evaluate("(()=>{const g=globalThis.CRESTBOUND&&CRESTBOUND.game;"
                               "return !!(g&&g.hero&&(g.state==='playing'||g.state==='keep'));})()"):
                    ok = True
                    break
                pg.evaluate(CLICK_JS)
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ok:
            print("never reached a live state")
            br.close()
            return 2
        pg.wait_for_timeout(1500)
        r = pg.evaluate(PROBE_JS, {"speed": a.speed, "seconds": a.seconds})
        br.close()

    if r.get("error"):
        print("ERROR %s" % r["error"])
        return 2
    rows = r["rows"]
    with open(os.path.join(HERE, "runcycleprobe.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, indent=2)

    def span(k):
        v = [x[k] for x in rows]
        return min(v), max(v), max(v) - min(v)

    print("speed %.1f m/s   %d samples over %.2f s" % (a.speed, len(rows), a.seconds))
    print("%-10s %9s %9s %9s   %s" % ("field", "min", "max", "swing", "swing deg"))
    for k in ("phase", "ulR", "ulL", "llR", "uaR", "uaL", "rigPitch", "rigY", "sqY",
              "ikW", "scarfDx", "scarfDy", "scarfDz"):
        lo, hi, sw = span(k)
        deg = "" if k in ("phase", "rigY", "sqY", "ikW", "scarfDx", "scarfDy", "scarfDz") \
            else "%8.1f deg" % math.degrees(sw)
        print("%-10s %9.4f %9.4f %9.4f   %s" % (k, lo, hi, sw, deg))
    print("dist travelled: %.2f m (%.2f stride cycles)" % (rows[-1]["dist"] - rows[0]["dist"],
                                                           (rows[-1]["dist"] - rows[0]["dist"]) / 1.90))
    print("page errors: %s" % errs[:5])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
