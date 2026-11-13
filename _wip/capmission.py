from playwright.sync_api import sync_playwright
import sys
idx=int(sys.argv[1]); out=sys.argv[2]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    pg.add_init_script(f"window.__FFG_TACTICS_MISSION__={idx};window.__FFG_TACTICS_AUTOSTART__=true;")
    pg.goto("http://localhost:8780/games/void-skirmish/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(2800)
    pg.screenshot(path=out); print("saved",out)
    b.close()
