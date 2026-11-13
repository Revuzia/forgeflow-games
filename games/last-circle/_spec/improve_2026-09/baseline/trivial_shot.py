import time, sys
sys.path.insert(0, ".")
from lc_mobile import FLAGS
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    for args, label in ((FLAGS, "d3d11"), (["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], "swiftshader")):
        br = pw.chromium.launch(channel="chrome", headless=True, args=args)
        pg = br.new_page()
        pg.set_content("<html><body style='background:#123'><canvas id=c width=300 height=150></canvas><script>const g=document.getElementById('c').getContext('webgl');g.clearColor(1,0,0,1);g.clear(g.COLOR_BUFFER_BIT);</script>hello</body></html>")
        t = time.time()
        try:
            pg.screenshot(path="trivial_%s.png" % label, timeout=60000); print(label, "ok", round(time.time() - t, 2), pg.evaluate("() => { const g = document.createElement('canvas').getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; }"))
        except Exception as e:
            print(label, "fail", str(e).splitlines()[0][:100])
        br.close()
