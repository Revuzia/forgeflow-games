#!/usr/bin/env python
"""Measure how DISTINCT each controller state's pose actually is.

For every CONTRACT §11 state the harness drives hero.update() at a fixed
1/60 s through that state's nominal life and, at 10/50/90 %, records the whole
blended rig: 19 bone rotations, the rig's own pitch/roll/yaw/offset and the
squash. Every state is then scored against the settled IDLE pose:

    rms   root-mean-square bone-rotation difference from idle, in degrees
    max   the single largest bone difference, in degrees
    root  |rig pitch| + |rig roll| + |rig yaw|, in degrees

A state whose whole-body difference from standing still is a couple of degrees
is not a pose — it is idle with a different name, and the screenshot critic
cannot tell them apart either.

    python posecheck.py [--course verdant-1]
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
  const A = globalThis.CRESTBOUND, G = A.game;
  const hero = G.hero, P = G.player;
  if (!hero || !P) return {error: 'no hero/player'};
  P.update = function () {};
  if (G.cam) G.cam.update = function () {};
  G._checkDeath = function () {};
  G.freezeHazards = true;

  const THREE = A.THREE;
  const p0 = P.pos.clone();
  const NAMES = ['hips','spine','chest','neck','head',
                 'shoulderR','upperArmR','lowerArmR','handR',
                 'shoulderL','upperArmL','lowerArmL','handL',
                 'upperLegR','lowerLegR','footR',
                 'upperLegL','lowerLegL','footL'];

  const write = (c, t) => {
    P.pos.copy(p0); P.prevPos.copy(p0); P.renderPos.copy(p0);
    P.vel.set(c.vx || 0, c.vy || 0, c.vz || 0);
    P.facing = 0;
    P.grounded = !!c.grounded; P.onGround = !!c.grounded;
    P.state = c.anim; P.anim = c.anim; P.stateT = t; P.animT = t;
    P.speed = Math.hypot(c.vx || 0, c.vz || 0);
    P.speedNorm = Math.min(1, P.speed / 9);
    P.leanX = c.lean || 0; P.dead = c.anim === 'dead'; P.heroFade = 0;
    P.inWater = c.inWater ? {} : null; P.submerged = !!c.submerged;
    P.crouching = c.anim === 'crouch' || c.anim === 'crouchwalk';
    P.sliding = c.anim === 'slide' || c.anim === 'slopeSlide';
    if (c.wallNx) {
      if (!P.wallN || typeof P.wallN.set !== 'function') P.wallN = new THREE.Vector3();
      P.wallN.set(c.wallNx, 0, c.wallNz || 0);
    } else P.wallN = null;
  };

  const snap = () => {
    const out = {b: [], rig: [
      +hero.rig.rotation.x.toFixed(4), +hero.rig.rotation.y.toFixed(4),
      +hero.rig.rotation.z.toFixed(4), +hero.rig.position.y.toFixed(4),
      +hero.rig.scale.y.toFixed(4)]};
    for (const n of NAMES) {
      const b = hero.bones[n];
      out.b.push(+b.rotation.x.toFixed(4), +b.rotation.y.toFixed(4), +b.rotation.z.toFixed(4));
    }
    return out;
  };

  const D = 1 / 60;
  const results = {};

  // reference: settled idle
  for (let k = 0; k < 180; k++) { write({anim:'idle', grounded:1}, k * D); hero.update(D, P); }
  results.__idle = snap();

  for (const st of o.states) {
    // neutral first, so the state change is a real edge
    const fromG = st.fromGrounded ? 1 : 0;
    for (let k = 0; k < 90; k++) {
      write({anim: st.from, grounded: fromG, vy: fromG ? 0 : -1}, k * D);
      hero.update(D, P);
    }
    const phases = {};
    let t = 0;
    for (const ph of [0.10, 0.50, 0.90]) {
      const target = st.dur * ph;
      const c = {anim: st.anim, grounded: st.grounded, vx: st.vx, vy: st.vy, vz: 0,
                 lean: st.lean, wallNx: st.wallNx, wallNz: st.wallNz,
                 inWater: st.inWater, submerged: st.submerged};
      while (t < target) {
        write(c, t);
        hero.update(D, P);
        t += D;
        if (st.gravity) c.vy -= st.gravity * D;
      }
      phases['p' + Math.round(ph * 100)] = snap();
    }
    results[st.anim] = phases;
  }
  return {results};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    a = ap.parse_args()

    # same contexts heroshots.py photographs
    sys.path.insert(0, HERE)
    from heroshots import STATES, GROUNDED_FROM
    states = []
    for (nm, dur, ctx) in STATES:
        states.append({
            "anim": nm, "dur": dur, "grounded": ctx.get("grounded", 1),
            "vx": ctx.get("vx", 0), "vy": ctx.get("vy", 0),
            "gravity": ctx.get("gravity", 0), "lean": ctx.get("lean", 0),
            "wallNx": ctx.get("wallNx", 0), "wallNz": ctx.get("wallNz", 0),
            "inWater": ctx.get("inWater", 0), "submerged": ctx.get("submerged", 0),
            "from": ctx.get("from_", "fall"),
            "fromGrounded": 1 if ctx.get("from_", "fall") in GROUNDED_FROM else 0,
        })

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 480, "height": 320})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto("%s?dev=1&course=%s" % (BASE, a.course), wait_until="load", timeout=60_000)
        dl, ok = time.time() + 90, False
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
        r = pg.evaluate(PROBE_JS, {"states": states})
        br.close()

    if r.get("error"):
        print("ERROR %s" % r["error"])
        return 2
    res = r["results"]
    idle = res.pop("__idle")

    def diff(a, b):
        n = len(a["b"])
        acc = 0.0
        mx = 0.0
        for i in range(n):
            d = abs(a["b"][i] - b["b"][i])
            acc += d * d
            mx = max(mx, d)
        rms = math.degrees(math.sqrt(acc / n))
        root = math.degrees(abs(a["rig"][0]) + abs(a["rig"][1]) + abs(a["rig"][2]))
        return rms, math.degrees(mx), root

    print("pose distinctness vs a settled IDLE  (degrees)")
    print("%-13s %8s %8s %8s   %8s %8s %8s   %8s %8s %8s"
          % ("state", "rms10", "max10", "root10", "rms50", "max50", "root50",
             "rms90", "max90", "root90"))
    rows = []
    for name, ph in res.items():
        cells = []
        for k in ("p10", "p50", "p90"):
            cells.extend(diff(ph[k], idle))
        rows.append((name, cells))
        print("%-13s %8.1f %8.1f %8.1f   %8.1f %8.1f %8.1f   %8.1f %8.1f %8.1f"
              % (name, *cells))
    weak = [n for (n, c) in rows if max(c[0], c[3], c[6]) < 6.0
            and max(c[2], c[5], c[8]) < 6.0]
    print("")
    print("STATES WITHIN 6 deg RMS AND 6 deg ROOT OF STANDING STILL (%d): %s"
          % (len(weak), ", ".join(weak) or "none"))
    with open(os.path.join(HERE, "posecheck.json"), "w", encoding="utf-8") as f:
        json.dump({"rows": [{"state": n, "cells": [round(x, 2) for x in c]} for (n, c) in rows],
                   "weak": weak}, f, indent=2)
    print("page errors: %s" % errs[:5])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
