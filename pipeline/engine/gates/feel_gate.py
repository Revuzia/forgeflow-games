"""feel_gate.py — Layer-4 feel (play-bot) gate.

Answers "can the game actually be PLAYED to a conclusion?" A Playwright bot loads
the game, drives the runtime's __test hooks (every FFG genre runtime exposes them),
and asserts the game makes progress and can reach a win/lose state — not just
"boots without crashing."

For tactics it scripts a greedy player: each turn, move the nearest unit toward
the nearest enemy and shoot when in range, then end turn; assert enemy HP trends
down and the match resolves within a turn budget.

Needs a running static server + a browser, so it runs OUTSIDE the interactive
session. Self-contained Playwright script.

Usage:
    python feel_gate.py <game_url>           e.g. http://localhost:8766/games/rift-tactics/
Requires: pip install playwright ; playwright install chromium
"""
import json
import sys

PROBE_JS = r"""
(async () => {
  function sceneOf(){ const g=window.__FFG_GAME__; if(!g) return null;
    return g.scene.scenes.find(s => s.__test) || null; }
  // wait for the scene + test hooks
  let scene=null, tries=0;
  while(!scene && tries++ < 60){ scene = sceneOf(); if(!scene) await new Promise(r=>setTimeout(r,250)); }
  if(!scene) return { ok:false, error:"no FFG scene with __test hooks" };
  const T = scene.__test;
  const start = T.state();
  const startEnemyHp = start.enemies.reduce((a,e)=>a+e.hp,0);
  let budget = 30;
  while(budget-- > 0){
    let st = T.state();
    if(st.ended) break;
    if(st.phase !== "player"){ T.endTurn(); continue; }
    // greedy: for each ally with AP, move toward nearest enemy then shoot
    for(const ally of st.allies){
      const sim = T.sim;
      const u = sim.getUnit(ally.id);
      let guard=4;
      while(u.actionPoints>0 && guard-->0 && !sim.ended){
        const enemies = sim.aliveEnemies();
        if(!enemies.length) break;
        enemies.sort((a,b)=> (Math.abs(a.x-u.x)+Math.abs(a.y-u.y)) - (Math.abs(b.x-u.x)+Math.abs(b.y-u.y)));
        const e = enemies[0];
        const dist = Math.abs(e.x-u.x)+Math.abs(e.y-u.y);
        if(dist<=u.range && sim.hasLineOfSight(u.x,u.y,e.x,e.y)){
          const r = T.attack(u.id, e.id); if(!r.success) break;
        } else {
          const path = sim.findPath(u.x,u.y,e.x,e.y);
          if(!path||!path.length) break;
          const steps = Math.min(path.length, u.movement);
          // step to the tile just before the enemy
          let dest = path[steps-1];
          if(dest.x===e.x && dest.y===e.y){ if(steps<2) break; dest = path[steps-2]; }
          if(!T.move(u.id, dest.x, dest.y)) break;
        }
      }
    }
    T.endTurn();
    if(T.state().ended) break;
  }
  const end = T.state();
  const endEnemyHp = end.enemies.reduce((a,e)=>a+e.hp,0);
  return {
    ok:true,
    started_enemies: start.enemies.length,
    ended: end.ended,
    result: end.result,
    enemy_hp_start: startEnemyHp,
    enemy_hp_end: endEnemyHp,
    progress: startEnemyHp - endEnemyHp,
    turns: end.turn,
  };
})()
"""


def run(url, timeout_ms=60000):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"ok": False, "error": "playwright not installed (pip install playwright; playwright install chromium)"}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(url, wait_until="load", timeout=timeout_ms)
        result = page.evaluate(PROBE_JS)
        result["console_errors"] = errors[:10]
        browser.close()
        return result


def grade(result):
    if not result.get("ok"):
        return False, "play-bot could not drive the game: " + result.get("error", "?")
    if result.get("progress", 0) <= 0:
        return False, "no combat progress (enemy HP did not drop) — mechanic likely inert"
    if not result.get("ended"):
        return False, f"match did not resolve within turn budget (turns={result.get('turns')})"
    return True, f"played to resolution in {result.get('turns')} turns, result={result.get('result')}"


def main():
    if len(sys.argv) < 2:
        print("usage: python feel_gate.py <game_url>")
        sys.exit(2)
    result = run(sys.argv[1])
    print(json.dumps(result, indent=2))
    ok, msg = grade(result)
    print(f"[feel_gate] {'PASS' if ok else 'FAIL'} — {msg}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
