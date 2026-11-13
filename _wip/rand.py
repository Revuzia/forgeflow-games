from playwright.sync_api import sync_playwright
import json
def layout():
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page()
        pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(2500)
        out=pg.evaluate("""()=>{const sim=window.__FFG3D__.controller.sim;
          return { enemy: sim.enemy.ships.map(s=>s.id+':'+s.cells.map(c=>c.x+','+c.y).join('|')) , seed: sim.rng ? 'fn' : 'none' };}""")
        b.close(); return out["enemy"]
a=layout(); b=layout()
print("game A enemy layout:", a[0])
print("game B enemy layout:", b[0])
print("DIFFERENT each game:", a != b)
