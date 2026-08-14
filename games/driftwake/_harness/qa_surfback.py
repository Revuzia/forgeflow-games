# -*- coding: utf-8 -*-
"""
qa_surfback.py -- reproduce "surf goes backwards from spawn" (port 8841).

Fresh boot (fresh Playwright profile => no saved position, spawn untouched).
REAL input: click canvas for pointer lock, hold W + RMB. For 8 compass
headings: release keys, reset position+velocity to spawn, set rig.yaw+facing,
press W+RMB again, then sample signed forward speed (velocity . facing) every
0.2 s of GAME time (combat.registry.time via rAF) for 6 s. Also records the
local terrain grade along the heading (heightAt gradient) and the slopeAssist
the controller would compute at that spot (mirror of controller.js:443).
"""
import subprocess
import sys
import json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8841
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SETUP_JS = """() => {
    const SF = SNOWFLOW, c = SF.character;
    window.__spawn = { x: c.position.x, z: c.position.z };
    return { spawn: window.__spawn,
             h: SF.terrain.heightAt(c.position.x, c.position.z) };
}"""

RESET_JS = """(yaw) => {
    const SF = SNOWFLOW, c = SF.character, s = window.__spawn;
    c.position.set(s.x, SF.terrain.heightAt(s.x, s.z), s.z);
    c.velocity.set(0, 0, 0);
    if ('vertVel' in c) c.vertVel = 0;
    c.facing = yaw;
    SF.rig.yaw = yaw;
    // static pre-measure at the spawn point along this heading
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const V = c.position.constructor, n = new V();
    SF.terrain.normalAt(s.x, s.z, n);
    const assist = -(n.x * fx + n.z * fz) * 26;   // controller.js:443 mirror
    const e = 1.0;
    const grade = (SF.terrain.heightAt(s.x + fx * e, s.z + fz * e)
                 - SF.terrain.heightAt(s.x - fx * e, s.z - fz * e)) / (2 * e);
    return { assist: +assist.toFixed(2), grade: +grade.toFixed(3) };
}"""

SAMPLE_JS = """async () => {
    const SF = SNOWFLOW, c = SF.character, reg = SF.combat.registry;
    const wait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const out = [];
    for (let i = 0; i < 30; i++) {
        await wait(0.2);
        const fx = Math.sin(c.facing), fz = -Math.cos(c.facing);
        const fwd = c.velocity.x * fx + c.velocity.z * fz;
        const e = 1.0;
        const grade = (SF.terrain.heightAt(c.position.x + fx * e,
                                           c.position.z + fz * e)
                     - SF.terrain.heightAt(c.position.x - fx * e,
                                           c.position.z - fz * e)) / (2 * e);
        out.push({ t: +((i + 1) * 0.2).toFixed(1), fwd: +fwd.toFixed(2),
                   spd: +c.speed.toFixed(2), surf: +c.surf.toFixed(2),
                   grade: +grade.toFixed(3),
                   x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1) });
    }
    return { samples: out, locked: SF.input.locked, surfHeld: SF.input.surf };
}"""


def run_battery(pg, only=None):
    import math
    rows = []
    for k in range(8):
        if only is not None and k * 45 not in only:
            continue
        yaw = k * math.pi / 4
        pg.keyboard.up("w")
        pg.mouse.up(button="right")
        pg.evaluate("() => new Promise(r => setTimeout(r, 400))")
        pre = pg.evaluate(RESET_JS, yaw)
        pg.keyboard.down("w")
        pg.mouse.down(button="right")
        res = pg.evaluate(SAMPLE_JS)
        s = res["samples"]
        fwds = [r["fwd"] for r in s]
        # sustained negative: >= 5 consecutive samples (1 s) below -0.1
        run = best = 0
        for f in fwds:
            run = run + 1 if f < -0.1 else 0
            best = max(best, run)
        tail = fwds[-10:]
        rows.append({
            "headingDeg": k * 45, "grade": pre["grade"],
            "assistPred": pre["assist"],
            "minFwd": min(fwds), "maxFwd": max(fwds),
            "meanTailFwd": round(sum(tail) / len(tail), 2),
            "sustainedNeg": best >= 5,
            "locked": res["locked"], "surfHeld": res["surfHeld"],
            "trace": s,
        })
    pg.keyboard.up("w")
    pg.mouse.up(button="right")
    return rows


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import time
        time.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            boot = pg.evaluate(SETUP_JS)
            print("SPAWN:", json.dumps(boot))
            # pointer lock via a real click on the canvas; Chrome can reject a
            # request too soon after load or a prior exit, so retry the click
            locked = False
            for _ in range(6):
                pg.mouse.click(640, 360)
                try:
                    pg.wait_for_function("() => SNOWFLOW.input.locked",
                                         timeout=5000)
                    locked = True
                    break
                except Exception:
                    pg.wait_for_timeout(1500)
            if not locked:
                raise RuntimeError("pointer lock never engaged")
            only = ([int(a) for a in sys.argv[1:]] or None)
            rows = run_battery(pg, only)
            for r in rows:
                trace = r.pop("trace")
                print(json.dumps(r))
                # compact trace: every 3rd sample
                print("   trace:", json.dumps(trace[::3]))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
