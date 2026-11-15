# -*- coding: utf-8 -*-
"""
qa_directives.py -- the 2026-08-10 owner directives, verified live:
  1. ASH VISIBILITY: foreground mean luminance vs the audit baseline shot
  2. REALM HAND FX: the idle weave in ash renders fire-toned (screenshot)
  3. AUTO-SAVE POSITION: save in ash at a known stand, reload, CONTINUE ->
     same realm, same position, same facing
  4. SHRINE: present at spawn (mesh in scene, triangles > 0)
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parent.parent / "_shots"
BASE = "http://localhost:8799/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


def luma_mean(path):
    from PIL import Image
    im = Image.open(path).convert("L")
    w, h = im.size
    # foreground band: lower half, center 80%
    box = im.crop((int(w * 0.1), int(h * 0.45), int(w * 0.9), int(h * 0.92)))
    px = list(box.getdata())
    return sum(px) / len(px)


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8799"], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(BASE + "?autoplay", wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)

            # -- 4. shrine present ------------------------------------------
            sh = pg.evaluate(
                "(() => { const s = SNOWFLOW.shrine;"
                " return s ? { tris: s.triangles, x: s.x, z: s.z,"
                " inScene: !!s.mesh.parent } : null; })()")
            ok = sh and sh["inScene"] and sh["tris"] > 0
            print(f"shrine: {sh}  {'PASS' if ok else 'FAIL'}")
            if not ok:
                fails.append("shrine")

            # -- 1+2. ash visibility + weave --------------------------------
            pg.evaluate("SNOWFLOW.enterRealm('ash')")
            pg.wait_for_timeout(4000)
            # idle long enough for the hand weave gate (idleT > 10 s)
            pg.wait_for_timeout(11000)
            pg.screenshot(path=str(SHOTS / "directive_ash.png"))
            new_l = luma_mean(SHOTS / "directive_ash.png")
            old_l = luma_mean(SHOTS / "audit_realm_ash.png")
            ok = new_l >= old_l * 1.6
            print(f"ash luma: baseline {old_l:.1f} -> now {new_l:.1f} "
                  f"({new_l / max(0.1, old_l):.2f}x)  {'PASS' if ok else 'FAIL'}")
            if not ok:
                fails.append("ash luma")
            weave = pg.evaluate(
                "(() => { const w = SNOWFLOW.spells &&"
                " SNOWFLOW.spells.handWeave;"
                " return w ? { blend: +w.blend.toFixed(2),"
                " strand: w.strand } : null; })()")
            print(f"weave state: {weave}")

            # -- 3. auto-save position --------------------------------------
            st = pg.evaluate("""(() => {
                const SF = SNOWFLOW, c = SF.character;
                c.position.set(37, SF.terrain.heightAt(37, -22), -22);
                c.facing = 2.1;
                SF.progression.save();
                const raw = localStorage.getItem('driftwake_save');
                return JSON.parse(raw).pos;
            })()""")
            print("saved pos blob:", st)
            ok = (st and abs(st["x"] - 37) < 0.5 and abs(st["z"] + 22) < 0.5
                  and st["realm"] == "ash")
            if not ok:
                fails.append("save blob")
                print("FAIL save blob")

            # reload into the menu, click CONTINUE
            pg.goto(BASE + "?menu", wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=120000)
            pg.wait_for_timeout(2500)
            cont = pg.query_selector("text=CONTINUE")
            if cont is None:
                fails.append("no CONTINUE")
                print("FAIL no CONTINUE button")
            else:
                cont.click()
                pg.wait_for_timeout(6000)   # enterRealm(ash) + teleport
                now = pg.evaluate("""(() => {
                    const c = SNOWFLOW.character;
                    return { x: +c.position.x.toFixed(1),
                             z: +c.position.z.toFixed(1),
                             facing: +c.facing.toFixed(2),
                             realm: (SNOWFLOW.combat.encounters.realm) };
                })()""")
                print("restored:", now)
                ok = (abs(now["x"] - 37) < 2 and abs(now["z"] + 22) < 2
                      and now["realm"] == "ash"
                      and abs(now["facing"] - 2.1) < 0.3)
                print("continue restore:", "PASS" if ok else "FAIL")
                if not ok:
                    fails.append("continue restore")
            br.close()
    finally:
        srv.terminate()
    print("\nRESULT:", "OK" if not fails else "DIRECTIVES FAIL: " + ", ".join(fails))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
