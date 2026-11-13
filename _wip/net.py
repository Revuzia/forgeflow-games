from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    bad=[]
    pg.on("response", lambda r: bad.append((r.status, r.url)) if r.status>=400 else None)
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(4000)
    for s,u in bad: print(s, u)
    b.close()
