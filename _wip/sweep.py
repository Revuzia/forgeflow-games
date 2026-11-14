"""AAA audit sweep — drive iron-tide through every beat and screenshot each."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8780/games/iron-tide/"
OUT = "_wip/aaa"

# Each beat: (name, async-js-body run after load + game-ready). The body has
# access to T (test hooks), K (kernel), C (controls), and `sleep(ms)`.
BEATS = {
 "01_menu": "await sleep(800);",
 "02_tutorial": "ctrl.shell.tutorial(); await sleep(500);",
 "03_settings": "ctrl.shell.settings(); await sleep(500);",
 "04_placement": """
    T.menuPlay(); await sleep(700);
    C.autoRotate=false; C.target.set(0,0,17.5); C.object.position.set(2,26,40); C.update();
    await sleep(400);""",
 "05_battle_overview": """
    T.menuPlay(); await sleep(500); T.placeAuto(); await sleep(900);
    C.autoRotate=false; C.target.set(0,0,2); C.object.position.set(0,40,46); C.update();
    await sleep(400);""",
 "06_miss": """
    T.menuPlay(); await sleep(400); T.placeAuto(); await sleep(700);
    // find a guaranteed-miss cell on the enemy board
    const occ=new Set(); for(const s of ctrl.sim.enemy.ships) for(const c of s.cells) occ.add(c.x+','+c.y);
    let mx=0,my=0; outer: for(let y=0;y<10;y++) for(let x=0;x<10;x++){ if(!occ.has(x+','+y)){mx=x;my=y;break outer;} }
    C.autoRotate=false; C.target.set(0,0,-12); C.object.position.set(0,18,2); C.update();
    T.fireAnimated(mx,my); await sleep(1100);""",
 "07_hit": """
    T.menuPlay(); await sleep(400); T.placeAuto(); await sleep(700);
    const s=ctrl.sim.enemy.ships[0]; const c=s.cells[0];
    C.autoRotate=false; C.target.set(0,0,-12); C.object.position.set(6,14,4); C.update();
    T.fireAnimated(c.x,c.y); await sleep(1400);""",
 "08_sink": """
    T.menuPlay(); await sleep(400); T.placeAuto(); await sleep(700);
    C.autoRotate=false; C.target.set(0,0,-12); C.object.position.set(4,13,2); C.update();
    const s=ctrl.sim.enemy.ships[4]||ctrl.sim.enemy.ships[0]; // destroyer (len2) if present
    for(const c of s.cells){ T.fireAnimated(c.x,c.y); await sleep(900); }
    await sleep(1200);""",
 "09_player_hit": """
    T.menuPlay(); await sleep(400); T.placeAuto(); await sleep(700);
    C.autoRotate=false; C.target.set(0,0,18); C.object.position.set(7,12,32); C.update();
    // fire many so the AI returns fire and scores hits on our visible fleet
    let n=0; for(let y=0;y<10&&n<16;y++) for(let x=0;x<10&&n<16;x++){ T.fireAnimated(x,y); n++; await sleep(160);}
    await sleep(900);""",
 "10_pause": """
    T.menuPlay(); await sleep(400); T.placeAuto(); await sleep(800); T.pause(); await sleep(400);""",
 "11_victory": """
    T.menuPlay(); await sleep(300); T.placeAuto(); await sleep(400);
    T.autoPlay(300); await sleep(200);
    if(ctrl.sim.ended){ ctrl.shell.end(ctrl.sim.winner==='player', 'Enemy fleet destroyed'); }
    await sleep(600);""",
}

PRELUDE = """
async (body) => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  let tries=0; while(!(window.__FFG3D__&&window.__FFG3D__.controller)&&tries++<60) await sleep(200);
  const ctrl = window.__FFG3D__.controller; const T = ctrl.__test; const K = window.__FFG3D__.kernel; const C = K.controls;
  const fn = new Function('sleep','ctrl','T','K','C', 'return (async()=>{'+body+'})();');
  await fn(sleep,ctrl,T,K,C);
  return true;
}
"""

def main():
    only = sys.argv[1] if len(sys.argv)>1 else None
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width":1280,"height":800})
        for name, body in BEATS.items():
            if only and only not in name: continue
            pg.goto(URL, wait_until="load", timeout=60000)
            try:
                pg.evaluate(PRELUDE, body)
            except Exception as e:
                print(f"  {name}: eval error {e}")
            pg.screenshot(path=f"{OUT}/{name}.png")
            print("saved", name)
        b.close()

if __name__ == "__main__":
    main()
