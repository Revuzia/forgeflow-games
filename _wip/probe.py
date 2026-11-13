from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(2500)
    out=pg.evaluate("""()=>{
      const B=window.FFG.sim.Battleship;
      const a=new B({size:10,seed:Math.floor(Math.random()*2e9)});
      const c=new B({size:10,seed:Math.floor(Math.random()*2e9)});
      const lay=s=>s.enemy.ships.map(x=>x.id+':'+x.cells[0].x+','+x.cells[0].y).join(' ');
      return { freshA:lay(a), freshC:lay(c), gameSim:lay(window.__FFG3D__.controller.sim),
               boot3dsrc: document.querySelector('script[src*=ffg_boot3d]').src };
    }""")
    import json; print(json.dumps(out,indent=2))
    b.close()
