"""art-wire lane — attribute the actor triangles, engine stopped, one render per toggle.

HARNESS_NOTES: a visibility probe on a RUNNING engine drifts ~10k triangles
between renders, so the engine is stopped and one composer render is taken per
configuration (the `_g1_triattr2.py` method).

    python _aw_tri.py verdant-3
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play  # noqa: E402

JS = r"""() => {
  const G = CRESTBOUND.game, E = CRESTBOUND.engine;
  E.stop && E.stop();
  const render = () => {
    E.renderer.info.reset();
    if (E.composer) E.composer.render(); else E.renderer.render(E.scene, E.camera);
    return E.renderer.info.render.triangles;
  };
  render();                       // warm
  const base = render();
  const cs = (G.course.critters || []).filter(c => c.model);
  const rows = [];
  // 1. every model off
  for (const c of cs) c.model.visible = false;
  const noModels = render();
  for (const c of cs) c.model.visible = !c._procOn;
  // 2. shadows off on every model
  const casters = [];
  for (const c of cs) c.model.traverse(o => { if (o.isMesh && o.castShadow) { casters.push(o); o.castShadow = false; } });
  const noShadow = render();
  for (const o of casters) o.castShadow = true;
  // 3. per critter
  for (const c of cs) {
    const was = c.model.visible;
    c.model.visible = false;
    const off = render();
    c.model.visible = was;
    const e = G.cam.camera.matrixWorld.elements;
    rows.push({ kind: c.kind, far: !!c._far, drawn: was,
                camD: +Math.hypot(c.pos.x-e[12], c.pos.y-e[13], c.pos.z-e[14]).toFixed(1),
                cost: base - off });
  }
  const after = render();
  E.start && E.start(G.__loop || undefined);
  return { base, noModels, noShadow, after, rows,
           draws: E.renderer.info.render.calls };
}"""


def run(course):
    with Play("aw_tri_" + course) as p:
        p.click_title()
        p.pg.wait_for_timeout(600)
        p.js("(id) => CRESTBOUND.game.__dev.goto(id)", course)
        for _ in range(80):
            if p.js("() => CRESTBOUND.game.course && CRESTBOUND.game.course.def.id === '%s'" % course):
                break
            p.pg.wait_for_timeout(250)
        for _ in range(80):
            if p.js("() => (CRESTBOUND.game.course.critters||[]).every(c => !!c.model)"):
                break
            p.pg.wait_for_timeout(250)
        p.pg.wait_for_timeout(1500)
        d = p.js(JS)
        print("=== %s ===" % course)
        print(json.dumps({k: v for k, v in d.items() if k != "rows"}, indent=1))
        for r in d["rows"]:
            print(" ", json.dumps(r))


if __name__ == "__main__":
    for c in (sys.argv[1:] or ["verdant-3"]):
        run(c)
