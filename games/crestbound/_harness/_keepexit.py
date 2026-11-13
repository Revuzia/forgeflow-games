#!/usr/bin/env python
"""Scratch probe (UI lane): does returnToKeep() land Nim ON the lobby floor?

Reproduces the reject's measurement exactly: play verdant-1, call
returnToKeep(), wait, then read pos / grounded / state / deaths. Also prints the
resolved gate's exit point next to keep.js's authored one, and the floor probe
under the landing spot.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
VIEW = {"width": 1280, "height": 720}
HERE = os.path.dirname(os.path.abspath(__file__))

STATE_JS = """() => { const g = CRESTBOUND.game; return {
  state: g.state, courseId: g.courseId, deaths: g.deaths,
  pos: g.player ? [ +g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2), +g.player.pos.z.toFixed(2) ] : null,
  grounded: g.player ? !!g.player.grounded : null,
  yaw: g.player && typeof g.player.facing === 'number' ? +g.player.facing.toFixed(3) : null,
}; }"""

fails = []


def ok(name, passed, detail=""):
    print(("  PASS  " if passed else "  FAIL  ") + name + (("   " + str(detail)[:300]) if detail else ""))
    if not passed:
        fails.append(name)


with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_context(viewport=VIEW).new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => globalThis.CRESTBOUND && CRESTBOUND.game", timeout=60000)
    try:
        pg.wait_for_function("() => CRESTBOUND.game.state === 'title'", timeout=180000)
    except Exception:
        print("  ..    state stuck at %r; errs=%s" % (pg.evaluate("() => CRESTBOUND.game.state"), errs[:3]))
        raise
    pg.evaluate("() => CRESTBOUND.game.newGame()")
    pg.wait_for_function("() => CRESTBOUND.game.state === 'keep'", timeout=60000)

    gates = pg.evaluate("""() => CRESTBOUND.game.__dev.gates().map(g => ({
      course: g.course, pos: [g.pos.x, g.pos.y, g.pos.z], yaw: +g.yaw.toFixed(3),
      exitPos: g.exitPos ? [ +g.exitPos.x.toFixed(2), +g.exitPos.y.toFixed(2), +g.exitPos.z.toFixed(2) ] : null,
      exitYaw: g.exitYaw != null ? +g.exitYaw.toFixed(3) : null }))""")
    g0 = [g for g in gates if g["course"] == "verdant-1"][0]
    print("  ..    verdant-1 gate: %s" % json.dumps(g0))
    ok("the resolved gate carries an exit stand-out point", g0["exitPos"] is not None, json.dumps(g0["exitPos"]))

    pg.evaluate("() => CRESTBOUND.game.__dev.goto('verdant-1')")
    pg.wait_for_function("() => ['playing','cinematic'].includes(CRESTBOUND.game.state)", timeout=90000)
    for _ in range(40):
        if pg.evaluate("() => CRESTBOUND.game.state") == "playing":
            break
        pg.evaluate("() => CRESTBOUND.game._endCinematic && CRESTBOUND.game._endCinematic(false)")
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(900)
    before = pg.evaluate(STATE_JS)
    print("  ..    in course: %s" % json.dumps(before))

    pg.evaluate("() => CRESTBOUND.game.returnToKeep()")
    pg.wait_for_function("() => CRESTBOUND.game.courseId === 'keep'", timeout=90000)
    pg.wait_for_timeout(2500)
    after = pg.evaluate(STATE_JS)
    print("  ..    after returnToKeep: %s" % json.dumps(after))

    floor = pg.evaluate("""() => { const g = CRESTBOUND.game; const p = g.player.pos;
      const bp = g.physWorld && g.physWorld.broadphase;
      if (!bp || typeof bp.raycast !== 'function') return null;
      const THREE = g.engine.camera.constructor === Object ? null : null;
      const hit = {};
      const from = { x: p.x, y: p.y + 1.2, z: p.z };
      const r = bp.raycast(from, { x: 0, y: -1, z: 0 }, 12, hit);
      return r ? { floorY: +(from.y - hit.t).toFixed(2), t: +hit.t.toFixed(2) } : { floorY: null };
    }""")
    print("  ..    floor under the landing spot: %s" % json.dumps(floor))

    ok("returnToKeep leaves the player ALIVE in the Keep",
       after["state"] == "keep" and after["deaths"] == before["deaths"],
       "state=%s deaths %s->%s" % (after["state"], before["deaths"], after["deaths"]))
    ok("he is standing on a floor, not falling",
       bool(after["grounded"]), "grounded=%s pos=%s" % (after["grounded"], after["pos"]))
    ok("he landed on the ROOM side of the painting (x > gate x)",
       after["pos"] is not None and after["pos"][0] > g0["pos"][0] + 0.5,
       "pos.x=%s gate.x=%s" % (after["pos"][0] if after["pos"] else None, g0["pos"][0]))
    ok("there is real floor under him", floor is not None and floor.get("floorY") is not None,
       json.dumps(floor))
    ok("he faces away from the wall (yaw ~ gate yaw + PI)",
       after["yaw"] is not None and abs(((after["yaw"] - (g0["yaw"] + 3.14159265)) + 3.14159265) % 6.2831853 - 3.14159265) < 0.35,
       "yaw=%s want=%s" % (after["yaw"], round(g0["yaw"] + 3.14159265, 3)))
    ok("no console / page errors", not errs, json.dumps(errs[:3]))
    br.close()

print("\nKEEP EXIT: %d failing" % len(fails))
sys.exit(1 if fails else 0)
