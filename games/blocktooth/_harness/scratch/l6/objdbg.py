import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate  # noqa: E402
args = add_common_args(argparse.ArgumentParser()).parse_args()
sess = Session(args, "l6objdbg"); sess.start()
PROJ = r"""() => { const c = window.__BT__.debugCore, W = window.__BT__.world, cam = c.camera;
  const proj = (x, y, z) => { const v = new cam.position.constructor(x, y, z); v.project(cam);
    return [+(((v.x + 1) / 2) * innerWidth).toFixed(0), +(((1 - v.y) / 2) * innerHeight).toFixed(0), +v.z.toFixed(3)]; };
  const out = { titan: [W.titan.x, W.titan.z, W.titan.height], objs: [] };
  for (const o of W.map.objectives) { if (!o.alive) continue;
    const p = o.target === 'prop' ? W.city.props[o.targetId] : null;
    out.objs.push({ k: o.kind, id: o.id, t: o.target, tid: o.targetId, x: +o.x.toFixed(1), z: +o.z.toFixed(1), h: o.h, r: o.r,
      prop: p ? { kind: p.kind, x: p.x, z: p.z, alive: p.alive } : null, base: proj(o.x, 0, o.z), top: proj(o.x, 4.8, o.z) }); }
  for (const n of ['obj:column', 'obj:unit', 'obj:crates', 'obj:icons', 'obj:rings', 'obj:arcs']) { const m = c.scene.getObjectByName(n); out[n] = m ? [m.visible, m.count] : null; }
  const dom = [...document.querySelectorAll('[data-v2="marker"]')].map(e => [e.className, e.style.transform, e.textContent.slice(0, 30)]);
  out.dom = dom; return out; }"""
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=7))
    sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
    sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
    print(sess.cheat("objective", "overloadSite"))
    time.sleep(1.0)
    print(json.dumps(sess.js(PROJ), indent=0))
    sess.screenshot(os.path.join(SHOTS, "l6", "objdbg.png"))
finally:
    sess.close()
