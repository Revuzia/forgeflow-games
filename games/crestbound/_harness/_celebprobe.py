#!/usr/bin/env python
"""Scratch probe (UI lane): WHAT makes the crest-celebration frame white?

Loads verdant-1, gives the open crest, and samples the same moment of the
celebration orbit three ways: as shipped, with the theme bloom restored (i.e.
without onCrest's x1.9 strength boost), and with bloom off entirely. Prints mean
luminance + %>200 for each so the cause is measured, not guessed.
"""
import base64
import io
import os
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
VIEW = {"width": 1600, "height": 900}


class Cap:
    def __init__(self, pg):
        self.pg = pg
        self.frames = []
        self.cdp = pg.context.new_cdp_session(pg)
        self.cdp.send("Page.enable")
        self.cdp.on("Page.screencastFrame", self._on)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92,
                                               "everyNthFrame": 1,
                                               "maxWidth": VIEW["width"], "maxHeight": VIEW["height"]})

    def _on(self, pl):
        self.frames.append((time.time(), pl["data"]))
        if len(self.frames) > 400:
            del self.frames[:200]
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": pl["sessionId"]})
        except Exception:
            pass

    def still(self, name=None):
        t = time.time()
        t0 = time.time()
        while time.time() - t0 < 25:
            fresh = [f for f in self.frames if f[0] > t]
            if len(fresh) >= 2:
                img = Image.open(io.BytesIO(base64.b64decode(fresh[-1][1]))).convert("RGB")
                if name:
                    img.save(os.path.join(HERE, "..", "_shots", name))
                return img
            self.pg.wait_for_timeout(60)
        return None


def lum(img):
    a = np.asarray(img).astype(np.float32)
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    return L.mean(), 100.0 * (L > 200).mean()


def run(mode, out):
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_context(viewport=VIEW).new_page()
        pg.goto(URL, wait_until="load", timeout=60000)
        cap = Cap(pg)
        pg.wait_for_function("() => globalThis.CRESTBOUND && CRESTBOUND.game", timeout=60000)
        pg.wait_for_function("() => CRESTBOUND.game.state === 'title'", timeout=60000)
        pg.evaluate("() => CRESTBOUND.game.newGame()")
        pg.wait_for_function("() => CRESTBOUND.game.state === 'keep'", timeout=60000)
        pg.evaluate("() => CRESTBOUND.game.__dev.goto('verdant-1')")
        pg.wait_for_function("() => ['playing','cinematic'].includes(CRESTBOUND.game.state)", timeout=90000)
        for _ in range(40):
            if pg.evaluate("() => CRESTBOUND.game.state") == "playing":
                break
            pg.evaluate("() => CRESTBOUND.game._endCinematic && CRESTBOUND.game._endCinematic(false)")
            pg.wait_for_timeout(250)
        pg.wait_for_timeout(1200)

        base = cap.still()
        print("%-16s BEFORE  mean %6.1f  >200 %5.1f%%" % (mode, *lum(base)))

        pg.evaluate("() => CRESTBOUND.game.__dev.give('open')")
        if mode == "themebloom":
            pg.evaluate("""() => { const g = CRESTBOUND.game;
              g.engine.post.setBloom(g.theme.bloom); }""")
        elif mode == "nobloom":
            pg.evaluate("""() => { const g = CRESTBOUND.game;
              g.engine.post.setBloom({ strength: 0, radius: 0.5, threshold: 4 }); }""")
        pg.wait_for_timeout(700)
        img = cap.still(out)
        print("%-16s CELEB   mean %6.1f  >200 %5.1f%%   bloom=%s" % (
            mode, *lum(img), pg.evaluate("() => JSON.stringify(CRESTBOUND.game.engine.post._bloom||null)")))
        br.close()


if __name__ == "__main__":
    m = sys.argv[1] if len(sys.argv) > 1 else "shipped"
    run(m, "_celeb_%s.png" % m)
