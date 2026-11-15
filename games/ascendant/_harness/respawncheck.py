"""Does respawning at a checkpoint kill you AGAIN, with no further input?

My previous test teleported to a position I computed myself and watched -- it
never exercised Game's real death -> resetFrom -> spawnFor -> respawn path, so it
passed while the player was still dying in play. This one kills the player ONCE
and then counts deaths the GAME causes on its own. Any death beyond the one I
asked for is an infinite crush.

  python probe_respawn_real.py foundry-3 4
"""
import sys, time, json
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

STAGE = sys.argv[1] if len(sys.argv) > 1 else "foundry-3"
_a2 = sys.argv[2] if len(sys.argv) > 2 else "all"
CP = "all" if _a2 == "all" else int(_a2)
URL = f"http://localhost:8788/games/ascendant/index.html?dev=1&stage={STAGE}"

TEST = r"""
async ([CPS, trials, watchMs]) => {
  const A = window.ASCENDANT, G = A.game, S = G.stage, P = G.player;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const list = (CPS === 'all')
    ? (S.checkpoints || []).map((_, i) => i) : [CPS];
  const out = { stage: S.def.id, rows: [] };

  for (const CP of list) {
   const cp = (S.checkpoints || [])[CP];
   if (!cp) continue;
   const cpp = cp.position || cp.pos || (cp.mesh && cp.mesh.position);
   const row = { cp: CP, cpPos: [ +cpp.x.toFixed(2), +cpp.y.toFixed(2), +cpp.z.toFixed(2) ],
                 unprompted: 0, spawnPos: null, grounded: null };
   for (let t = 0; t < trials; t++) {
    // Put the game in the state a player is in when they die at this checkpoint,
    // then use the REAL death path and do not touch anything afterwards.
    G.cpIndex = CP;
    const before = G.deaths | 0;
    P.kill('manual');                       // the one death we asked for

    // wait for the game to finish its own respawn
    let restored = false;
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      await frame();
      if (!P.dead && G.state === 'playing') { restored = true; break; }
    }
    const afterRespawn = G.deaths | 0;
    const spawnPos = [ +P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2) ];

    // now WATCH. no input, no teleport. any further death is the game killing us.
    let extra = 0;
    const t1 = performance.now();
    while (performance.now() - t1 < watchMs) {
      await frame();
      const d = (G.deaths | 0) - afterRespawn;
      if (d > extra) extra = d;
    }
    row.unprompted += extra;
    row.spawnPos = spawnPos; row.grounded = !!P.grounded;
    await new Promise(r => setTimeout(r, 200));
   }
   out.rows.push(row);
  }
  out.totalUnprompted = out.rows.reduce((a, r) => a + r.unprompted, 0);
  return out;
}
"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1100, "height": 700})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
    pg.goto(URL, wait_until="load", timeout=90000)
    for _ in range(200):
        if pg.evaluate("!!(window.ASCENDANT && window.ASCENDANT.game)"):
            break
        pg.wait_for_timeout(400)
    t0 = time.time()
    while time.time() - t0 < 30:
        if pg.evaluate("window.ASCENDANT.game.state") not in ("title", "loading"):
            break
        pg.evaluate("(function(){var G=ASCENDANT.game; if(G.menu&&G.menu._act)G.menu._act('play');})()")
        pg.wait_for_timeout(500)
    pg.evaluate(f"window.ASCENDANT.game.__dev.goto('{STAGE}')")
    for _ in range(150):
        if pg.evaluate("window.ASCENDANT.game.stage && window.ASCENDANT.game.stage.def.id") == STAGE:
            break
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(2500)
    res = pg.evaluate(TEST, [CP, 2, 4000])
    br.close()


if "error" not in res:
    print()
    print(f"{res['stage']}: respawn safety per checkpoint")
    for r in res["rows"]:
        flag = "OK  " if r["unprompted"] == 0 else "KILL"
        print(f"  cp{r['cp']:<2} {flag} cp={r['cpPos']} spawned={r['spawnPos']} grounded={r['grounded']} unprompted={r['unprompted']}")
    print("TOTAL unprompted deaths =", res["totalUnprompted"],
          "->", "PASS" if res["totalUnprompted"] == 0 else "FAIL (infinite crush)")
if errs:
    print("page errors:", errs[:3])
