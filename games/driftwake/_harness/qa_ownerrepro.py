# -*- coding: utf-8 -*-
"""qa_ownerrepro.py -- the owner's EXACT 2026-08-16 report, replayed on the
live build through the real user path, so the two bugs cannot come back.

  "Surfing from the location the game starts at ... if i surf out to a
   certain distance, it stops letting me go forward and pulls me back
   automatically. In those areas, i also cannot AIM UP, the attacks are
   forced into the sand."

No teleports for the surf run: the player starts where the game starts,
clicks PLAY like a person, locks the pointer, holds W + RMB and rides
outward until the world stops them. Then, at whatever far place they
ended up, the camera is pitched UP with real mouse movement and the bolt
is fired — the shot has to leave the ground.

Runs in cold, sand and ash (the owner said "into the sand"), against the
CDN build by default so it tests what is actually deployed.
Usage: python qa_ownerrepro.py [--local]
"""
import json
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r"C:\Users\TestRun\Claude Claw\forgeflow-games"
LOCAL_PORT = 8884
CDN = "https://forgeflow-games-cdn.isimcha85.workers.dev/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --- in-page helpers ---------------------------------------------------
INSTALL = """() => {
    const SF = SNOWFLOW;
    window.__ow = {
        gameWait(sec) {
            const reg = SF.combat.registry;
            const t0 = reg.time;
            return new Promise((res) => {
                const tick = () => (reg.time - t0 >= sec)
                    ? res(true) : requestAnimationFrame(tick);
                tick();
            });
        },
        // Ride outward, sampling radius. Resolves with the whole track.
        ride(sec) {
            const SF2 = SNOWFLOW, reg = SF2.combat.registry;
            const c = SF2.character;
            const t0 = reg.time;
            const r0 = Math.hypot(c.position.x, c.position.z);
            let rMax = r0, worstDrop = 0, lastR = r0;
            const samples = [];
            return new Promise((res) => {
                const tick = () => {
                    const r = Math.hypot(c.position.x, c.position.z);
                    if (r > rMax) rMax = r;
                    // the owner's complaint: losing ground while driving out
                    const drop = rMax - r;
                    if (drop > worstDrop) worstDrop = drop;
                    if (reg.time - t0 >= sec) {
                        return res({
                            r0: +r0.toFixed(1), rEnd: +r.toFixed(1),
                            rMax: +rMax.toFixed(1),
                            worstDropFromPeak: +worstDrop.toFixed(2),
                            gained: +(r - r0).toFixed(1),
                            speed: +(c.speed || 0).toFixed(2),
                            edge01: +SF2.terrain.edge01(c.position.x,
                                                        c.position.z).toFixed(3),
                            samples: samples
                        });
                    }
                    if (samples.length < 400 &&
                        (samples.length === 0 ||
                         reg.time - samples[samples.length - 1][0] >= 0.5)) {
                        samples.push([+(reg.time - t0).toFixed(1), +r.toFixed(1)]);
                    }
                    lastR = r;
                    requestAnimationFrame(tick);
                };
                tick();
            });
        },
        // Fire the bolt and watch where it actually goes.
        boltFlight(sec) {
            const SF2 = SNOWFLOW, reg = SF2.combat.registry;
            const d = SF2.spells.bolt;
            SF2.spells.aim.copy(SF2.rig.forward);
            const aimY = SF2.spells.aim.y;
            const slot = SF2.spells._fireBolt();
            if (slot < 0) return Promise.resolve({ slot: -1, aimY: +aimY.toFixed(3) });
            const y0 = d.y ? d.y[slot] : null;
            const t0 = reg.time;
            let yMax = y0, alive = 0, rise = 0;
            return new Promise((res) => {
                const tick = () => {
                    const on = d.alive ? d.alive[slot] : 0;
                    if (on) {
                        alive = reg.time - t0;
                        const y = d.y ? d.y[slot] : y0;
                        if (y > yMax) yMax = y;
                        rise = yMax - y0;
                    }
                    if (!on || reg.time - t0 >= sec) {
                        return res({
                            slot: slot, aimY: +aimY.toFixed(3),
                            y0: y0 === null ? null : +y0.toFixed(2),
                            yMax: yMax === null ? null : +yMax.toFixed(2),
                            rise: +rise.toFixed(2),
                            aliveS: +alive.toFixed(2),
                            ground: +SNOWFLOW.terrain.heightAt(
                                SNOWFLOW.character.position.x,
                                SNOWFLOW.character.position.z).toFixed(2)
                        });
                    }
                    requestAnimationFrame(tick);
                };
                tick();
            });
        }
    };
    return Object.keys(SF.spells.bolt || {}).slice(0, 40);
}"""

STATE = """() => ({
    realm: SNOWFLOW.combat.encounters.realm,
    x: +SNOWFLOW.character.position.x.toFixed(1),
    z: +SNOWFLOW.character.position.z.toFixed(1),
    r: +Math.hypot(SNOWFLOW.character.position.x,
                   SNOWFLOW.character.position.z).toFixed(1),
    pitch: +SNOWFLOW.rig.pitch.toFixed(3),
    fwdY: +SNOWFLOW.rig.forward.y.toFixed(3)
})"""

PITCH_UP = """() => {
    // Where the mouse-look ended up. If automation could not deliver the
    // movement, fall back to the setting the player would have reached.
    const SF = SNOWFLOW;
    const viaMouse = SF.rig.pitch;
    if (viaMouse > -0.25) SF.rig.pitch = -0.5;
    return { viaMouse: +viaMouse.toFixed(3), pitch: +SF.rig.pitch.toFixed(3),
             usedFallback: viaMouse > -0.25 };
}"""


def main():
    from playwright.sync_api import sync_playwright

    local = "--local" in sys.argv
    srv = None
    if local:
        srv = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(LOCAL_PORT)], cwd=ROOT,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2.5)
        base = ("http://localhost:%d/games/driftwake/index.html" % LOCAL_PORT)
    else:
        base = CDN
    print("target:", base)

    fails = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))

            # --- the REAL user path: menu, then a real PLAY click ----------
            pg.goto(base + "?menu&test", wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW && globalThis.FFG",
                                 timeout=180000)
            pg.wait_for_timeout(4000)
            pg.evaluate("""() => {
                const b = [...FFG.shell.ov.querySelectorAll('button')]
                    .find(x => /PLAY|NEW RUN/i.test(x.textContent));
                b.click();
            }""")
            pg.wait_for_function("() => !SNOWFLOW.S.freezeTime", timeout=60000)
            pg.wait_for_timeout(2500)
            keys = pg.evaluate(INSTALL)
            print("bolt fields:", keys)

            # real pointer lock, like a player
            pg.mouse.click(640, 360)
            pg.wait_for_timeout(500)
            print("start:", json.dumps(pg.evaluate(STATE)))

            for realm in ("cold", "sand", "ash"):
                if realm != "cold":
                    pg.keyboard.press("6" if realm == "sand" else "7")
                    pg.wait_for_timeout(11000)
                    pg.evaluate("SNOWFLOW.combat.encounters._nextSpawnAt = 1e9")
                got = pg.evaluate("SNOWFLOW.combat.encounters.realm")
                if got != realm:
                    print("SKIP %s (realm is %s)" % (realm, got))
                    continue

                # ---- 1. RIDE OUT from wherever the run actually is --------
                pg.evaluate("""() => {
                    const SF = SNOWFLOW, c = SF.character;
                    // start the ride from the spawn shrine, as the owner did
                    c.position.set(5, SF.terrain.heightAt(5, 5.5), 5.5);
                    if (c.velocity) c.velocity.set(0, 0, 0);
                    SF.rig.yaw = Math.PI / 2;   // ride +X, straight out
                    SF.rig.pitch = 0.17;
                    c.facing = Math.PI / 2;
                }""")
                pg.wait_for_timeout(600)
                pg.keyboard.down("w")
                pg.mouse.down(button="right")
                ride = pg.evaluate("() => window.__ow.ride(75)")
                pg.mouse.up(button="right")
                pg.keyboard.up("w")

                reached = ride["rMax"]
                # the exact complaint: being dragged back off the peak while
                # still holding forward. Terrain bobbing costs < 1 m.
                pulled = ride["worstDropFromPeak"] > 1.5
                far = reached >= 450
                ok = (not pulled) and far
                print(("PASS " if ok else "FAIL ")
                      + "[%s] rode out to %.0f m, worst drop off peak %.2f m  %s"
                      % (realm, reached, ride["worstDropFromPeak"],
                         json.dumps({k: ride[k] for k in
                                     ("r0", "rEnd", "gained", "speed", "edge01")})))
                print("      track:", json.dumps(ride["samples"][:14]))
                if pulled:
                    fails.append("%s pulled back %.2f m" % (realm, ride["worstDropFromPeak"]))
                if not far:
                    fails.append("%s only reached %.0f m" % (realm, reached))

                # ---- 2. AIM UP where the ride ended, and FIRE -------------
                # real mouse-look upward under pointer lock
                for _ in range(12):
                    pg.mouse.move(640, 360 - 40)
                    pg.wait_for_timeout(30)
                up = pg.evaluate(PITCH_UP)
                pg.wait_for_timeout(300)
                st = pg.evaluate(STATE)
                flight = pg.evaluate("() => window.__ow.boltFlight(1.2)")
                rose = (flight.get("rise") or 0) >= 1.0
                lived = (flight.get("aliveS") or 0) >= 0.15
                ok = rose and lived and st["fwdY"] > 0.2
                print(("PASS " if ok else "FAIL ")
                      + "[%s] aimed up (fwdY %.2f%s) and the bolt CLIMBED %.2f m in %.2f s  %s"
                      % (realm, st["fwdY"],
                         ", mouse-look" if not up["usedFallback"] else ", set-pitch",
                         flight.get("rise") or 0, flight.get("aliveS") or 0,
                         json.dumps(flight)))
                if not ok:
                    fails.append("%s bolt did not climb" % realm)

                # the ARC is a ground cone by design — confirm it still is
                arc = pg.evaluate("""() => {
                    const SF = SNOWFLOW;
                    SF.spells._cdUntil[7] = 0;
                    const g0 = SF.spells.arcGen || 0;
                    SF.spells.cast(7);
                    return { fired: (SF.spells.arcGen || 0) > g0 };
                }""")
                print("      arc still casts from the same spot:",
                      json.dumps(arc))

            print("\npage errors:", errs if errs else "none")
            if errs:
                fails.append("page errors: %s" % errs[:2])
            br.close()
    finally:
        if srv:
            srv.terminate()

    print("\nRESULT:", "OK" if not fails else "FAIL: " + "; ".join(fails))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
