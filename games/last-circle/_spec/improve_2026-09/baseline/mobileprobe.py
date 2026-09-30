import json, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    dev = p.devices["Pixel 7"]
    ctx = br.new_context(**dev)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 1500 * 1000 / 8, "uploadThroughput": 750 * 1000 / 8})
    t0 = time.time()
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html", wait_until="commit")
    page.wait_for_timeout(2500)
    snap = lambda: page.evaluate("() => ({coarse: matchMedia('(pointer: coarse)').matches, splash: !!document.getElementById('lc-splash'), text: (document.body.innerText||'').trim().slice(0,160), lc: !!window.__LC__, canvas: !!document.querySelector('canvas')})")
    print("t2.5", json.dumps(snap()))
    page.screenshot(path="shot_mobile_card.png")
    page.wait_for_selector("text=PLAY ANYWAY", timeout=60000)
    print("card at", round(time.time() - t0, 1), json.dumps(snap()))
    page.screenshot(path="shot_mobile_card.png")
    print("hit:", page.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'PLAY ANYWAY'); const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return {rect: [r.x, r.y, r.width, r.height], topTag: top && top.tagName, topId: top && top.id, topText: top && (top.textContent||'').slice(0,60), topZ: top && getComputedStyle(top).zIndex}; }"""))
    try:
        page.get_by_text("PLAY ANYWAY").click(timeout=5000)
        tc = time.time()
        print("clicked PLAY ANYWAY at", round(tc - t0, 1))
        for dt in (1.0, 3.0, 6.0):
            page.wait_for_timeout(int((dt - (time.time() - tc)) * 1000) if dt > time.time() - tc else 10)
            s = snap(); print("+%.0fs" % dt, json.dumps(s))
            if dt == 3.0: page.screenshot(path="shot_mobile_after_play_3s.png")
        page.wait_for_function("!!window.__LC__", timeout=90000)
        print("__LC__ at", round(time.time() - t0, 1), "s wall; after click", round(time.time() - tc, 1))
    except Exception as e:
        print("ERR", str(e)[:200])
    br.close()
