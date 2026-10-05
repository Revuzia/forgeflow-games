# -*- coding: utf-8 -*-
"""qa_rewards_gpu.py -- lane R environment check: which WebGL renderer does a
fresh harness Chrome get, and how fast does a trivial rAF loop tick?"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 640, "height": 360})
        pg.set_content("<canvas id=c></canvas>")
        print(pg.evaluate("""async () => {
            const gl = document.getElementById('c').getContext('webgl2');
            if (!gl) return {webgl2: false};
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            let n = 0; const t0 = performance.now();
            await new Promise(res => { const f = () => (++n >= 60) ? res() : requestAnimationFrame(f); requestAnimationFrame(f); });
            return {webgl2: true, renderer: r, fps60: Math.round(60000 / (performance.now() - t0))};
        }"""))
        br.close()


if __name__ == "__main__":
    main()
