"""SCRATCH. Reads the settled camera pose at the perfcheck probe points, to show
whether this lane's solver changes the frustum there (draws follow the frustum)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camshots as CS
from playwright.sync_api import sync_playwright
POINTS = {"verdant-1": [[0,2,40],[0,9,-14],[10,14.4,-26]], "keep": [[0,0.1,-1],[-14,-8,4],[0,0.1,16.4]]}
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=CS.FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.goto(CS.DEFAULT_URL, wait_until="load", timeout=180000)
    for _ in range(40):
        if pg.evaluate(CS.STATE_JS) in ("keep","playing"): break
        pg.evaluate(CS.CLICK_JS); pg.wait_for_timeout(600)
    for _ in range(60):
        if pg.evaluate(CS.READY_JS): break
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    for course, pts in POINTS.items():
        if course != "keep":
            pg.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", course)
            for _ in range(60):
                if pg.evaluate(CS.STATE_JS)=="playing" and pg.evaluate("CRESTBOUND.game.courseId")==course: break
                pg.wait_for_timeout(200)
            pg.wait_for_timeout(1200)
        for p in pts:
            pg.evaluate("(p) => CRESTBOUND.game.__dev.tp(p[0],p[1],p[2])", p)
            pg.wait_for_timeout(1200)
            s = pg.evaluate("""() => { const c=(CRESTBOUND.game.cam||CRESTBOUND.game.camera).__test.state();
              return {dist:+c.dist.toFixed(4), slide:+c.yawSlide.toFixed(4), pitch:+c.pitch.toFixed(4),
                      drop:+c.focusDrop.toFixed(4), fade:+c.heroFade.toFixed(3)}; }""")
            print("%-10s %-18s %s" % (course, p, json.dumps(s)))
    br.close()
