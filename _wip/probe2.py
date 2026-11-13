from playwright.sync_api import sync_playwright
import json, time
def one():
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page()
        pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(2200)
        out=pg.evaluate("""()=>{
          const lay=s=>s.enemy.ships.map(x=>x.id[0]+x.cells[0].x+','+x.cells[0].y).join(' ');
          const B=window.FFG.sim.Battleship;
          const seedExpr=(((Date.now()&0x7fffffff)^Math.floor(Math.random()*0x7fffffff))>>>0)||1;
          return { game:lay(window.__FFG3D__.controller.sim), now:Date.now(), reconstruct:lay(new B({size:10,seed:seedExpr})), seedExpr };
        }""")
        b.close(); return out
a=one(); time.sleep(1.5); b=one()
print("A:", json.dumps(a)); print("B:", json.dumps(b))
print("game layouts differ:", a["game"]!=b["game"], "| reconstruct differ:", a["reconstruct"]!=b["reconstruct"])
