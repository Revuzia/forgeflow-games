import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate  # noqa: E402
args = add_common_args(argparse.ArgumentParser()).parse_args()
sess = Session(args, "l6pu"); sess.start()
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=7))
    sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
    sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
    for k in ("redLight", "rushHour", "backPay"):
        print(k, sess.cheat("powerup", k))
    time.sleep(1.0)
    print(json.dumps(sess.js("""() => { const c = window.__BT__.debugCore; const W = window.__BT__.world;
      const o = c.scene.getObjectByName('powerup:plate'); const f = c.scene.getObjectByName('powerup:faces');
      const r = c.scene.getObjectByName('powerup:rings');
      const m = []; if (o) { const e = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) m.push([e[i*16+12], e[i*16+13], e[i*16+14], e[i*16]].map(v => +v.toFixed(2))); }
      return { plate: o && { vis: o.visible, count: o.count, m }, faces: f && { vis: f.visible, count: f.count }, rings: r && { vis: r.visible, count: r.count },
               pus: W.map.powerups.map(p => ({ k: p.kind, alive: p.alive, x: +p.x.toFixed(1), z: +p.z.toFixed(1), h: p.h, t: +p.t.toFixed(2) })),
               titan: [W.titan.x, W.titan.z, W.titan.height] }; }""")))
    sess.screenshot(os.path.join(SHOTS, "l6", "pudbg.png"))
finally:
    sess.close()
