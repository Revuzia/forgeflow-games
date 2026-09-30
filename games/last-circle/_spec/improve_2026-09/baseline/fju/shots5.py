"""feel-juice-ui lane, pass 5: menu over time (operative preview pose) at 3 viewports; wordmark clip
measurement. Read-only against the repo."""
import json, os
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
P = {}
with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    for (w, h) in [(1280, 720), (1920, 1080), (1366, 768)]:
        ctx = br.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.add_init_script("try { localStorage.setItem('lc_seen_howto','1'); } catch (e) {}")
        page.goto(URL)
        page.wait_for_function("() => !!window.__LC__", timeout=90000)
        try: page.get_by_text("GOT IT").first.click(timeout=2500)
        except Exception: pass
        for t in (1, 4, 9):
            page.wait_for_timeout(1000 if t == 1 else 3000 if t == 4 else 5000)
            page.screenshot(path=os.path.join(OUT, f"60_menu_{w}x{h}_t{t}.png"))
        # measure the big wordmark: the element whose text is LAST CIRCLE with the largest font
        P[f"{w}x{h}"] = page.evaluate("""() => { let best = null;
            for (const el of document.querySelectorAll('div')) { if (el.textContent !== 'LAST CIRCLE') continue;
              const fs = parseFloat(getComputedStyle(el).fontSize); const r = el.getBoundingClientRect();
              if (!best || fs > best.fs) best = { fs, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; }
            return best; }""")
        ctx.close()
    json.dump(P, open(os.path.join(OUT, "probes5.json"), "w"), indent=1)
    print(json.dumps(P, indent=1))
    br.close()
