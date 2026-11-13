from playwright.sync_api import sync_playwright
import json, time
def one():
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(); logs=[]
        pg.on("console", lambda m: logs.append(m.text) if "game seed" in m.text else None)
        pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(2200)
        out=pg.evaluate("""()=>{const lay=s=>s.enemy.ships.map(x=>x.id[0]+x.cells[0].x+','+x.cells[0].y).join(' ');return lay(window.__FFG3D__.controller.sim);}""")
        b.close(); return out, (logs[0] if logs else "?")
a,sa=one(); time.sleep(1.2); b,sb=one()
print("A seed log:", sa, "| layout:", a)
print("B seed log:", sb, "| layout:", b)
print("DIFFERENT:", a!=b)
