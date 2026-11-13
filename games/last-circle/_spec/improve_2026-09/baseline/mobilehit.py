import json, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(**p.devices["Pixel 7"])
    page = ctx.new_page()
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_selector("text=PLAY ANYWAY", timeout=60000)
    page.wait_for_timeout(500)
    r = page.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'PLAY ANYWAY'); const r = b.getBoundingClientRect();
        let top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); const chain = [];
        for (let e = top; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); chain.push({tag: e.tagName, id: e.id, cls: String(e.className).slice(0,40), pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents, inset: [cs.top, cs.left, cs.width, cs.height].join(' ')}); }
        const card = b.closest('div[style*="inset"]') || b.parentElement.parentElement; const cc = getComputedStyle(card);
        return {chain, cardZ: cc.zIndex, cardPos: cc.position, cardParent: card.parentElement && card.parentElement.id}; }""")
    print(json.dumps(r, indent=0))
    # does a real tap (touchscreen) on the button reach it?
    b = page.get_by_text("PLAY ANYWAY").bounding_box()
    page.touchscreen.tap(b["x"] + b["width"]/2, b["y"] + b["height"]/2)
    page.wait_for_timeout(1500)
    print("after tap, card still present:", page.evaluate("!!document.evaluate(\"//button[text()='PLAY ANYWAY']\", document, null, 9, null).singleNodeValue"))
    page.mouse.click(b["x"] + b["width"]/2, b["y"] + b["height"]/2)
    page.wait_for_timeout(1500)
    print("after mouse click, card still present:", page.evaluate("!!document.evaluate(\"//button[text()='PLAY ANYWAY']\", document, null, 9, null).singleNodeValue"))
    br.close()
