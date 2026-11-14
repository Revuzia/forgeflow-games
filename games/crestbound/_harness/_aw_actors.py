"""art-wire lane — read the modelled critters live.

For every critter on a course: did its GLB land, which clips did it resolve,
where does the model's BOUNDING BOX sit against the creature's own ground, and
is the procedural body actually hidden. Prints a table; no gate.

    python _aw_actors.py verdant-1 [ember-1 ...]
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play  # noqa: E402

PROBE = r"""() => {
  const G = globalThis.CRESTBOUND && CRESTBOUND.game;
  const T = CRESTBOUND.THREE;
  if (!G || !G.course) return null;
  const out = [];
  const box = new T.Box3();
  for (const c of (G.course.critters || [])) {
    const row = { kind: c.kind, state: c.state, clipState: c._clipState,
                  model: !!c.model, procOn: !!c._procOn,
                  clips: c._clips ? c._clips.map(k => k.name) : null,
                  action: c._clipAction ? c._clipAction.getClip().name : null,
                  hidden: c._procHidden ? c._procHidden.length : 0,
                  pos: [+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2)],
                  groundY: (c.groundY === undefined ? null : +c.groundY.toFixed(2)) };
    const e = G.cam && G.cam.camera && G.cam.camera.matrixWorld.elements;
    if (e) row.camD = +Math.hypot(c.pos.x-e[12], c.pos.y-e[13], c.pos.z-e[14]).toFixed(1);
    row.far = !!c._far; row.procOn = !!c._procOn;
    if (c.model) {
      c.model.updateMatrixWorld(true);
      box.setFromObject(c.model);
      row.mbox = [+box.min.y.toFixed(3), +box.max.y.toFixed(3)];
      row.mh = +(box.max.y - box.min.y).toFixed(3);
      row.mx = [+box.min.x.toFixed(2), +box.max.x.toFixed(2)];
    }
    out.push(row);
  }
  const st = CRESTBOUND.engine && CRESTBOUND.engine.stats;
  return { rows: out, draws: st ? st.drawCalls : null, tris: st ? st.tris : null };
}"""

WAIT = r"""() => {
  const G = globalThis.CRESTBOUND && CRESTBOUND.game;
  if (!G || !G.course) return false;
  const cs = G.course.critters || [];
  if (!cs.length) return true;
  return cs.every(c => !!c.model);
}"""


def run(course):
    with Play("aw_" + course) as p:
        p.click_title()
        p.pg.wait_for_timeout(800)
        p.js("(id) => CRESTBOUND.game.__dev.goto(id)", course)
        for _ in range(80):
            if p.js("() => CRESTBOUND.game.course && CRESTBOUND.game.course.def.id === '%s'" % course):
                break
            p.pg.wait_for_timeout(250)
        p.pg.wait_for_timeout(1200)
        ok = False
        for _ in range(80):
            if p.js(WAIT):
                ok = True
                break
            p.pg.wait_for_timeout(250)
        p.pg.wait_for_timeout(600)
        d = p.js(PROBE)
        print("=== %s === models all loaded: %s  draws %s tris %s"
              % (course, ok, d and d["draws"], d and d["tris"]))
        for r in (d["rows"] if d else []):
            print(json.dumps(r))
        print("console:", [c for c in p.console if "warn" not in c.lower()][:6])


if __name__ == "__main__":
    for c in (sys.argv[1:] or ["verdant-1"]):
        run(c)
