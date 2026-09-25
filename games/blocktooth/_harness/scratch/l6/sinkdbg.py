import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate  # noqa: E402
from ultshots import WAIT_JS  # noqa: E402
args = add_common_args(argparse.ArgumentParser()).parse_args()
sess = Session(args, "l6sink"); sess.start()
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=5))
    sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
    sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); c.ult(100); }")
    time.sleep(0.2); sess.press("KeyE")
    print(sess.js(WAIT_JS, ["blast", 0.5]))
    info = sess.js("""() => { const c = window.__BT__.debugCore; const o = c.scene.getObjectByName('ult:sinkhole');
      const g = o.geometry; const p = g.getAttribute('position'); let ymin=1e9,ymax=-1e9; for (let i=0;i<p.count;i++){ymin=Math.min(ymin,p.getY(i));ymax=Math.max(ymax,p.getY(i));}
      const m = o.material; return {n: p.count, ymin, ymax, side: m.side, type: m.type, vc: m.vertexColors, transparent: m.transparent, opacity: m.opacity, visible: m.visible,
        hasColor: !!g.getAttribute('color'), hasNormal: !!g.getAttribute('normal'), drawRange: g.drawRange, layers: o.layers.mask, matrixAuto: o.matrixAutoUpdate,
        world: o.matrixWorld.elements.map(v=>+v.toFixed(2)) }; }""")
    print(json.dumps(info))
    sess.js("() => { const o = window.__BT__.debugCore.scene.getObjectByName('ult:sinkhole'); o.position.y = 0.6; o.userData.dbg = 1; }")
    time.sleep(0.2)
    sess.screenshot(os.path.join(SHOTS, "l6", "sinkdbg.png"))
finally:
    sess.close()
