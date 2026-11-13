"""Which browser mode gives real rAF + a real GPU on this box? (read-only check)"""
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
        "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required"]
JS = r"""
async () => {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
  let gpu = 'none'; try { const e = gl.getExtension('WEBGL_debug_renderer_info'); gpu = gl.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (e) {}
  let n = 0; const t0 = performance.now();
  await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  return { gpu, rafPerSec: +(n / ((performance.now() - t0) / 1000)).toFixed(1), vis: document.visibilityState, focus: document.hasFocus() };
}
"""
with sync_playwright() as p:
    for label, kw in [("headed", dict(headless=False, args=BASE)),
                      ("headless-new", dict(headless=True, args=BASE + ["--enable-gpu", "--enable-unsafe-swiftshader"])),
                      ("headless-new-nogpuflag", dict(headless=True, args=BASE))]:
        try:
            br = p.chromium.launch(channel="chrome", **kw)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto("about:blank")
            print(label, pg.evaluate(JS), flush=True)
            br.close()
        except Exception as e:
            print(label, "ERR", str(e)[:200], flush=True)
