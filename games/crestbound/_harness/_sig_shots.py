#!/usr/bin/env python
"""Signage-lane close shots: boot a course at the AUTO tier (or --quality), then
photograph a list of stations. Two station kinds:

  follow  {name, kind:'follow', p:[x,y,z], dist?, yaw?}   hero teleported to p,
          follow camera pulled to dist (optional cam yaw override)
  vista   {name, kind:'vista', cam:[x,y,z], look:[x,y,z]} camera placed directly

    python _sig_shots.py --course verdant-1 --quality low --out-prefix ../_shots/sig_v1 \
        --stations '[{"name":"sign","kind":"vista","cam":[3,3.6,45],"look":[3,3.5,41]}]'

Headless Chrome with the d3d11 flags = the real Intel UHD (HARNESS_NOTES).
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return want;
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

POSE_JS = r"""
async (o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const st = o.st;
  const cam = G.cam, C3 = G.engine.camera;
  if (globalThis.__cbVistaRestore) globalThis.__cbVistaRestore();
  if (st.kind === 'vista') {
    const orig = cam.update;
    globalThis.__cbVistaRestore = () => { cam.update = orig; delete globalThis.__cbVistaRestore; };
    cam.update = function () {};
    if (st.hero) {
      G.player.__test.teleport(new THREE.Vector3(st.hero[0], st.hero[1], st.hero[2]));
      G.player.__test.setVel(new THREE.Vector3(0, 0, 0));
    }
    for (let k = 0; k < 40; k++) {
      C3.position.set(st.cam[0], st.cam[1], st.cam[2]);
      C3.up.set(0, 1, 0);
      C3.lookAt(st.look[0], st.look[1], st.look[2]);
      C3.updateMatrixWorld(true);
      await frame();
    }
    return {ok: true, kind: 'vista'};
  }
  const P = G.player;
  const put = () => {
    P.__test.teleport(new THREE.Vector3(st.p[0], st.p[1] + 0.4, st.p[2]));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
  };
  put();
  if (Number.isFinite(st.dist)) cam.dist = st.dist;
  if (Number.isFinite(st.yaw)) cam.yaw = st.yaw; else if (cam.recenter) cam.recenter();
  for (let k = 0; k < 60; k++) { if (Number.isFinite(st.yaw)) cam.yaw = st.yaw; await frame(); }
  const e = G.engine;
  return {ok: true, p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          draws: e.stats && e.stats.drawCalls, tris: e.stats && e.stats.tris,
          scale: e.renderScale !== undefined ? e.renderScale : null};
}
"""


def leave_title(pg, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try: last = pg.evaluate(STATE_JS)
        except Exception: last = None
        if last in ("keep", "playing"): return True
        try: pg.evaluate(CLICK_JS)
        except Exception: pass
        pg.wait_for_timeout(400)
    return False


def goto_course(pg, cid, timeout=90):
    pg.evaluate("async (id) => { const d = CRESTBOUND.game.__dev; await d.goto(id); }", cid)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("(id)=>!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId===id"
                           " && (CRESTBOUND.game.state==='playing'||CRESTBOUND.game.state==='keep'))", cid):
                return True
        except Exception: pass
        try:
            if pg.evaluate(STATE_JS) in ("card", "cinematic", "title", "paused"): pg.evaluate(CLICK_JS)
        except Exception: pass
        pg.wait_for_timeout(400)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", required=True)
    ap.add_argument("--quality", default="low")
    ap.add_argument("--stations", required=True, help="JSON list")
    ap.add_argument("--out-prefix", required=True)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    stations = json.loads(a.stations)
    errs = []
    with sync_playwright() as p:
        if a.headed:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        else:
            try: br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception: br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": a.width, "height": a.height})
        pg.on("pageerror", lambda e: errs.append("PAGE " + str(e)))
        pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
        pg.goto("%s?dev=1&quality=%s" % (BASE, a.quality), wait_until="load", timeout=60_000)
        deadline = time.time() + 70
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            except Exception: pass
            pg.wait_for_timeout(400)
        if not leave_title(pg):
            print("never live"); br.close(); return 2
        if a.course != "keep" or pg.evaluate("CRESTBOUND.game.courseId") != "keep":
            if not goto_course(pg, a.course):
                print("never arrived at", a.course); br.close(); return 2
        pg.wait_for_timeout(1200)
        for st in stations:
            r = pg.evaluate(POSE_JS, {"st": st})
            out = "%s_%s.png" % (a.out_prefix, st["name"])
            pg.screenshot(path=out)
            print(st["name"], json.dumps(r), "->", out)
        try: pg.evaluate("globalThis.__cbVistaRestore && globalThis.__cbVistaRestore()")
        except Exception: pass
        br.close()
    for e in errs[:20]: print("ERR", e)
    print("errors:", len(errs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
