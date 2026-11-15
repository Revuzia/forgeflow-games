import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heroshots as HS
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
OUT = HS.OUT
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=HS.HEADLESS_FLAGS)
    pg = br.new_page(viewport={"width": 900, "height": 900})
    pg.goto(HS.BASE + "?dev=1&course=verdant-1", wait_until="load", timeout=60000)
    dl = time.time() + 60
    while time.time() < dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.hero)"): break
        except Exception: pass
        pg.wait_for_timeout(400)
    HS.leave_title(pg); pg.wait_for_timeout(2500)
    spot = pg.evaluate(HS.FINDSPOT_JS, {"r": 12.0, "clear": 7.0})["spot"]
    pg.evaluate(HS.SEIZE_JS)
    # sun direction + shadow camera, so a missing shadow can be explained
    info = pg.evaluate(r"""()=>{const E=CRESTBOUND.game.engine;let s=null;
      E.scene.traverse(o=>{if(o.isDirectionalLight&&o.castShadow&&!s){const c=o.shadow.camera;
        s={dir:[+o.position.x.toFixed(2),+o.position.y.toFixed(2),+o.position.z.toFixed(2)],
           target:[+o.target.position.x.toFixed(2),+o.target.position.y.toFixed(2),+o.target.position.z.toFixed(2)],
           cam:{l:c.left,r:c.right,t:c.top,b:c.bottom,n:c.near,f:c.far},
           bias:o.shadow.bias,normalBias:o.shadow.normalBias,radius:o.shadow.radius};}});
      return s;}""")
    print(json.dumps(info, indent=2))
    o = {"anim": "idle", "hold": 1.2, "grounded": 1, "vx": 0, "vy": 0, "vz": 0,
         "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
         "az": 55, "dist": 6.0, "el": 26, "aimY": 0.4, "spot": spot}
    pg.evaluate(HS.POSE_JS, o)
    a = os.path.join(OUT, "_j_sd_with.png"); pg.screenshot(path=a, timeout=120000)
    # hide only the hero rig; the blob is a separate mesh, hide it too
    pg.evaluate("()=>{const h=CRESTBOUND.game.hero;h.rig.visible=false;if(h.shadowBlob&&h.shadowBlob.mesh)h.shadowBlob.mesh.visible=false;if(h.scarfMesh)h.scarfMesh.visible=false;}")
    pg.wait_for_timeout(300)
    b = os.path.join(OUT, "_j_sd_without.png"); pg.screenshot(path=b, timeout=120000)
    br.close()
A = Image.open(a).convert("L"); B = Image.open(b).convert("L")
d = ImageChops.difference(A, B)
px = list(d.getdata())
n = sum(1 for v in px if v > 6)
print("changed pixels (hero + its shadow): %d of %d (%.2f%%)" % (n, len(px), 100.0*n/len(px)))
# amplify the difference so the shadow footprint is visible
d.point(lambda v: min(255, v*6)).save(os.path.join(OUT, "_j_sd_diff.png"))
print("wrote _j_sd_diff.png")
