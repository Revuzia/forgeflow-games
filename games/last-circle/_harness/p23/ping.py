#!/usr/bin/env python
"""ping - LC-07 ping (P1-D + its fix ffe96307, in the base): the ping rows of F:/lc_p1/P1-D/p1d_hud.py promoted to a gate (P2-F port).
C-PING: P1-D's ping API is the squad comms channel of the wave (W._hudPings; bots may answer pings through W.pings).

    python _harness/p23/ping.py --disk
    python _harness/p23/ping.py --rev e10b9836                  # control: the snapshot before P1 (no ping at all) - MUST FAIL
    python _harness/p23/ping.py --disk --plant no-expiry        # every ping re-born each frame - MUST FAIL (never expires)
    python _harness/p23/ping.py --disk --plant flood            # the local 1 / s limit lifted - MUST FAIL (three presses = three pings)

STANDARD match (Savanna seed 7), 1280x720, landed under the harness guard, loop frozen, frames stepped. Rows:
  contract        W._hudPings (P1-D's test surface) exists
  one-tick        Z (the rebindable Ping action) at a ~120 m terrain line: ONE marker in the world, the compass and the minimap within one HUD tick
  distance        the pip reads 120 +- 3 m (within 1.5 m of the measured line)
  at-point        a location ping (kind go) within 1.5 m of the aimed point
  rate            three presses inside 1 s place ONE ping
  mmb-replaces    middle mouse replaces this player's world ping (still one marker)
  edge            behind the player: an edge arrow + the compass tick clamped to the strip end
  expiry          gone after its 30 s lifetime
  bigmap-pin      M, a click: ONE pin at the clicked map point (+-1 % of the map), the map stays open; right-click clears; a click beside closes
  regrab          after the map closes the pointer is locked again (P1-D-fix)
  errors
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "no-expiry": "W.kernel._updaters.push(() => { const P = W._hudPings; if (P) for (const q of P.list) q.born = W.t; })",
    "flood": "Object.defineProperty(W._hudPings, 'lastLocal', { configurable: true, get: () => -1e9, set: () => {} })",
}

AIM_JS = r"""(want) => {
  const C = window.__LC__, W = C.W, p = W.player, K = W.SIM, map = W.map, cam = W.camera || W.kernel.camera;
  const dir = new p.pos.constructor(), cols = [];
  let best = null;
  const tried = [];
  for (let yi = 0; yi < 24 && !best; yi++) {
    const yaw = (yi / 24) * Math.PI * 2;
    for (let pi = 0; pi < 90; pi++) {
      const pitch = 0.06 - pi * 0.002;
      p.input.yaw = yaw; p.input.pitch = pitch; p.yaw = yaw;
      C.stepFrames(1, 1 / 60, false);
      cam.updateMatrixWorld(); cam.getWorldDirection(dir);
      const o = cam.position;
      let hit = null;
      for (let d = 2; d < 400; d += 0.2) { const x = o.x + dir.x * d, y = o.y + dir.y * d, z = o.z + dir.z * d; if (map.heightAt(x, z) > y) { hit = { d, x, y, z }; break; } }
      if (!hit) continue;
      const ex = p.pos.x, ey = p.pos.y + 1.6, ez = p.pos.z;
      const dEye = (ex - o.x) * dir.x + (ey - o.y) * dir.y + (ez - o.z) * dir.z;
      const d0 = Math.min(8, Math.max(0.05, dEye));
      const ar = K.aimRayDist(o.x, o.y, o.z, dir.x, dir.y, dir.z, d0, 600, (x, z) => map.heightAt(x, z), (x, z, r, b) => map.queryColliders(x, z, r, b), cols);
      const dist = Math.hypot(hit.x - p.pos.x, hit.y - p.pos.y, hit.z - p.pos.z);
      if (yi === 0 && pi % 10 === 0) tried.push([+pitch.toFixed(3), +dist.toFixed(1), +ar.toFixed(1), +hit.d.toFixed(1)]);
      if (Math.abs(ar - hit.d) < 0.5 && Math.abs(dist - want) < 2.5) { best = { yaw, pitch, expect: +dist.toFixed(2), rayD: +hit.d.toFixed(2), aimRayD: +ar.toFixed(2), hit: [+hit.x.toFixed(1), +hit.y.toFixed(1), +hit.z.toFixed(1)] }; break; }
    }
  }
  if (best) C.stepFrames(1, 1 / 60, true);
  return best || { none: true, tried };
}"""

PINGVIEW_JS = r"""() => {
  const W = window.__LC__.W, P = W._hudPings;
  const pips = [...document.querySelectorAll('[data-lc="pings"] .lc-ping')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ txt: e.textContent.trim(), cls: e.className }));
  const ticks = [...document.querySelectorAll('[data-lc="compasspings"] .lc-cping')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.style.left);
  return { list: P.list.map((q) => ({ owner: q.owner, kind: q.kind, src: q.src, dist: q.dist, scr: q.scr, cmp: q.cmp, x: +q.x.toFixed(1), y: +q.y.toFixed(1), z: +q.z.toFixed(1) })),
           placed: P.placed, mmDrawn: P.mmDrawn, pips, ticks, bigmap: !!document.querySelector('[data-lc="bigmapcanvas"]') };
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=7)
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)
    tag = "rev_" + args.rev if args.rev else ("plant_" + args.plant if args.plant else "disk")

    def body(v):
        with C.Session(args, "p23_ping", viewport={"width": 1280, "height": 720}) as s:
            s.boot()
            s.sleep(1.0)
            s.js("() => { try { localStorage.setItem('lc_seen_intro', '1'); } catch (e) {} }")
            L.dismiss_cards(s)
            v.data["start"] = s.start_match("standard", args.seed, args.map, enter=True, guard=True)
            s.freeze_loop()
            s.install_pump()
            s.land(150, protect=True)
            s.step_frames(30, 1 / 60, render=True)
            has = s.safe_js("() => !!window.__LC__.W._hudPings", default=False)
            v.check("contract (W._hudPings: the P1-D ping API)", has, {"present": has}, "present")
            if not has:
                L.errors_row(v, s)
                return
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            aim = s.js(AIM_JS, 120)
            v.data["aim"] = aim
            if not aim or aim.get("none"):
                v.cnj("one-tick (ping at ~120 m)", "no clear 120 m terrain line from the landing spot")
                return
            s.page.keyboard.press("z")
            s.step_frames(1, 1 / 60, render=True)
            pv = s.js(PINGVIEW_JS)
            p0 = pv["list"][0] if pv["list"] else None
            lbl = pv["pips"][0]["txt"] if pv["pips"] else ""
            digits = "".join(ch for ch in lbl if ch.isdigit() or ch == ".")
            shown = float(digits) if digits else None
            v.check("one-tick (Z: ONE marker in world, compass and minimap within one HUD tick)",
                    len(pv["list"]) == 1 and len(pv["pips"]) == 1 and len(pv["ticks"]) == 1 and pv["mmDrawn"] == 1,
                    {"placed": pv["placed"], "mmDrawn": pv["mmDrawn"], "list": len(pv["list"]), "pips": len(pv["pips"]), "ticks": len(pv["ticks"])}, "1 / 1 / 1 / 1")
            v.check("distance (the pip reads 120 +- 3 m)", shown is not None and abs(shown - 120) <= 3 and abs(shown - aim["expect"]) <= 1.5,
                    {"label": lbl, "expect": aim["expect"]}, "120 +- 3")
            v.check("at-point (kind go within 1.5 m of the aimed point)", bool(p0) and p0["kind"] == "go" and math.dist([p0["x"], p0["y"], p0["z"]], aim["hit"]) <= 1.5,
                    {"ping": p0, "hit": aim["hit"]}, "<= 1.5 m")
            s.screenshot(os.path.join(shots, "ping_%s_world.png" % tag))
            s.sleep(1.1)
            n0 = s.js(PINGVIEW_JS)["placed"]
            t0 = s.js("() => performance.now()")
            for _ in range(3):
                s.page.keyboard.press("z")
            t1 = s.js("() => performance.now()")
            s.step_frames(1, 1 / 60, render=True)
            n1 = s.js(PINGVIEW_JS)["placed"]
            v.check("rate (three presses inside 1 s place ONE ping)", n1 == n0 + 1 and (t1 - t0) < 1000, {"before": n0, "after": n1, "ms": round(t1 - t0)}, "+1")
            s.sleep(1.1)
            s.js("([y, p]) => { const P = window.__LC__.W.player; P.input.yaw = y + 0.6; P.input.pitch = p; window.__LC__.stepFrames(1, 1/60, true); }", [aim["yaw"], aim["pitch"]])
            s.page.mouse.click(640, 360, button="middle")
            s.step_frames(1, 1 / 60, render=True)
            pv2 = s.js(PINGVIEW_JS)
            v.check("mmb-replaces (middle mouse replaces the world ping: still one marker)", pv2["placed"] == n1 + 1 and len(pv2["list"]) == 1,
                    {"placed": pv2["placed"], "list": len(pv2["list"])}, "placed +1, 1 marker")
            s.js("([y, p]) => { const P = window.__LC__.W.player; P.input.yaw = y + 0.6 + Math.PI; P.input.pitch = p; window.__LC__.stepFrames(2, 1/60, true); }", [aim["yaw"], aim["pitch"]])
            pv3 = s.js(PINGVIEW_JS)
            e3 = pv3["list"][0] if pv3["list"] else {}
            v.check("edge (behind: edge arrow + compass tick clamped)",
                    bool(e3) and (e3.get("scr") or {}).get("edge") is True and (e3.get("cmp") or {}).get("edge") is True and "edge" in (pv3["pips"][0]["cls"] if pv3["pips"] else ""),
                    {"scr": e3.get("scr"), "cmp": e3.get("cmp")}, "edge true / true")
            s.screenshot(os.path.join(shots, "ping_%s_edge.png" % tag))
            s.js("() => window.__LC__.fastForward(31, 1/60)")
            s.step_frames(1, 1 / 60, render=True)
            left = s.js(PINGVIEW_JS)["list"]
            v.check("expiry (gone after its 30 s lifetime)", len(left) == 0, {"left": left}, "0 left")
            # big map pin: the loop thawed (the map is a real overlay), the pointer locked first so the regrab row means something
            s.thaw_loop()
            L.lock_pointer(s)
            s.page.keyboard.press("m")
            s.sleep(0.8)
            cvr = s.js("() => { const c = document.querySelector('[data-lc=\"bigmapcanvas\"]'); if (!c) return null; const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
            if not cvr:
                v.check("bigmap-pin (M opens the big map with a pin canvas)", False, {"canvas": None}, "open")
            else:
                s.page.mouse.click(cvr[0] + cvr[2] * 0.62, cvr[1] + cvr[3] * 0.40)
                s.sleep(0.5)
                pv = s.js(PINGVIEW_JS)
                pins = [q for q in pv["list"] if q["kind"] == "pin"]
                S = s.js("() => window.__LC__.W.map.size")
                ex, ez = (0.62 - 0.5) * S, (0.40 - 0.5) * S
                placed = len(pins) == 1 and pv["bigmap"] and abs(pins[0]["x"] - ex) <= S * 0.01 and abs(pins[0]["z"] - ez) <= S * 0.01
                s.screenshot(os.path.join(shots, "ping_%s_bigmap.png" % tag))
                s.page.mouse.click(cvr[0] + cvr[2] * 0.62, cvr[1] + cvr[3] * 0.40, button="right")
                s.sleep(0.4)
                pvc = s.js(PINGVIEW_JS)
                cleared = not [q for q in pvc["list"] if q["kind"] == "pin"] and pvc["bigmap"]
                s.page.mouse.click(max(5, cvr[0] - 40), cvr[1] + cvr[3] / 2)
                s.sleep(0.8)
                closed = not s.js("() => !!document.querySelector('[data-lc=\"bigmapcanvas\"]')")
                v.check("bigmap-pin (click = ONE pin at the point +-1 %, map stays open; right-click clears; click beside closes)", placed and cleared and closed,
                        {"pins": pins, "expect": [round(ex, 1), round(ez, 1)], "cleared": cleared, "closed": closed}, "placed, cleared, closed")
                lk = s.wait_js("() => !!document.pointerLockElement", 2, 0.1)
                v.check("regrab (the pointer is locked again after the map closes)", lk is not None, {"lockedAfterS": lk}, "locked")
            s.freeze_loop()
            L.errors_row(v, s)
    return C.run_gate("p23_ping", body, args)


if __name__ == "__main__":
    sys.exit(main())
