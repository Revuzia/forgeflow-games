import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.route("**/esm.sh/**", lambda r: r.abort("blockedbyclient"))
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_function("!!window.__LC__", timeout=60000)
    page.wait_for_timeout(1500)
    page.evaluate("() => window.__LC__.W.events.emit('openOnline', {mode: 'standard'})")
    page.wait_for_timeout(800)
    page.get_by_text("CREATE ROOM", exact=True).click()
    page.wait_for_timeout(10000)
    r = page.evaluate("""() => { const b = [...document.querySelectorAll('button')].filter(x => /CREATE ROOM|JOIN/.test(x.textContent)).map(x => x.textContent + ':' + (x.disabled ? 'disabled' : 'enabled'));
        const t = [...document.querySelectorAll('div')].map(d => d.textContent).filter(t => /Connecting/.test(t)).slice(-1)[0]; return {buttons: b, connectingText: t ? t.slice(0, 120) : null}; }""")
    print(json.dumps(r)); print("pageerrors:", json.dumps(errs))
    page.screenshot(path="shot_esm_block.png")
    br.close()
