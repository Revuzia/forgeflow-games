# -*- coding: utf-8 -*-
"""qa_edgebug.py -- reproduce the owner's two far-field reports:
   (1) surfing out to a distance stops going forward and pulls back
   (2) in those areas the aim cannot go UP; attacks go into the ground"""
import json, subprocess, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\TestRun\Claude Claw\forgeflow-games"
PORT = 8881
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=ROOT, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:%d/games/driftwake/index.html?autoplay" % PORT,
                    wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            print("PLAY_RADIUS:", pg.evaluate("SNOWFLOW.terrain.playRadius"))

            pg.mouse.click(640, 360)
            pg.wait_for_timeout(300)
            for r in (300, 500, 560, 580, 600, 615):
                pg.evaluate("""(r) => {
                    const SF = SNOWFLOW, c = SF.character;
                    c.position.set(r, SF.terrain.heightAt(r, 0), 0);
                    if (c.velocity) c.velocity.set(0, 0, 0);
                    SF.rig.yaw = Math.PI / 2;
                    c.facing = Math.PI / 2;
                }""", r)
                pg.wait_for_timeout(400)
                pg.keyboard.down("w")
                pg.mouse.down(button="right")
                out = pg.evaluate("""() => new Promise((res) => {
                    const SF = SNOWFLOW, reg = SF.combat.registry;
                    const t0 = reg.time, r0 = Math.hypot(SF.character.position.x,
                                                         SF.character.position.z);
                    let rMax = r0;
                    const tick = () => {
                        const c = SF.character;
                        const r = Math.hypot(c.position.x, c.position.z);
                        if (r > rMax) rMax = r;
                        if (reg.time - t0 >= 3.0) {
                            const p = SF.terrain.edgePush(c.position.x, c.position.z);
                            return res({ r0: +r0.toFixed(1), rEnd: +r.toFixed(1),
                                rMax: +rMax.toFixed(1),
                                gained: +(r - r0).toFixed(2),
                                push: +Math.hypot(p.fx, p.fz).toFixed(2),
                                speed: +(SF.character.speed || 0).toFixed(2) });
                        }
                        requestAnimationFrame(tick);
                    };
                    tick();
                })""")
                pg.mouse.up(button="right")
                pg.keyboard.up("w")
                print("OUTWARD r=%-4s %s" % (r, json.dumps(out)))
                pg.wait_for_timeout(300)

            for r in (100, 600):
                aim = pg.evaluate("""(r) => {
                    const SF = SNOWFLOW, c = SF.character;
                    c.position.set(r, SF.terrain.heightAt(r, 0), 0);
                    if (c.velocity) c.velocity.set(0, 0, 0);
                    SF.rig.yaw = Math.PI / 2;
                    SF.rig.pitch = -0.55;
                    SF.rig.update(0.016, c.position,
                        c.velocity || {x:0,y:0,z:0}, 0, 0);
                    SF.spells.aim.copy(SF.rig.forward);
                    return { r, pitch: +SF.rig.pitch.toFixed(3),
                             fwdY: +SF.rig.forward.y.toFixed(3),
                             aimY: +SF.spells.aim.y.toFixed(3),
                             camY: +SF.rig.camera.position.y.toFixed(2),
                             groundLift: +(SF.rig.groundLift || 0).toFixed(2),
                             charY: +c.position.y.toFixed(2),
                             ground: +SF.terrain.heightAt(c.position.x, c.position.z).toFixed(2) };
                }""", r)
                print("AIMUP r=%-4s %s" % (r, json.dumps(aim)))

            print("page errors:", errs if errs else "none")
            br.close()
    finally:
        srv.terminate()

if __name__ == "__main__":
    main()
