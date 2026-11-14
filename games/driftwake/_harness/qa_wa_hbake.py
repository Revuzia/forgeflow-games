# -*- coding: utf-8 -*-
"""
qa_wa_hbake.py -- export the REAL per-realm heightfield for lane W's Node probe.

Opens _harness/wa_hbake.html (the game's own Heightfield class, the realms'
own landform blocks and wind directions -- no game boot, no frame loop), bakes
cold, sand and ash on the GPU, and writes each CPU mirror (2048^2 float32 at
1 m, exactly what terrain.heightAt() samples) to
_harness/_wa_heights/<realm>.f32 plus meta.json. qa_worldact_node.mjs then
places caches, trials and bounties on that ground in Node.

    python _harness/qa_wa_hbake.py
"""
import base64
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
PORT = 8923
URL = "http://localhost:%d/games/driftwake/_harness/wa_hbake.html" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
OUT = HERE / "_wa_heights"
CH = 4 * 1024 * 1024


def main():
    from playwright.sync_api import sync_playwright
    OUT.mkdir(exist_ok=True)
    (OUT / ".gitignore").write_text("*\n", encoding="utf-8")
    srv = subprocess.Popen([sys.executable, str(HERE / "qa_server.py"), str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    meta = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 320, "height": 240})
            pg.set_default_timeout(900000)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:300]))
            t0 = time.time()
            pg.goto(URL, wait_until="commit", timeout=600000)
            pg.wait_for_function("() => window.__ready || window.__err", timeout=900000,
                                 polling=1000)
            err = pg.evaluate("() => window.__err || null")
            print("page ready in %.1f s, err=%s" % (time.time() - t0, err))
            if err:
                raise RuntimeError(err)
            for realm in ("cold", "sand", "ash"):
                info = pg.evaluate("(r) => window.__bake(r)", realm)
                print("bake", json.dumps(info))
                if info["readError"]:
                    raise RuntimeError("readback error %s" % info["readError"])
                parts = []
                i = 0
                while True:
                    c = pg.evaluate("([i, ch]) => window.__chunk(i, ch)", [i, CH])
                    if c["n"] <= 0:
                        break
                    parts.append(base64.b64decode(c["b64"]))
                    i += 1
                    if i * CH >= c["total"]:
                        break
                data = b"".join(parts)
                (OUT / ("%s.f32" % realm)).write_bytes(data)
                info["bytes"] = len(data)
                meta[realm] = info
                print("wrote %s.f32 (%d bytes)" % (realm, len(data)))
            (OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
            print("page errors:", errs[:10])
            br.close()
    finally:
        srv.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
