"""art-wire lane — park the lens on every modelled critter and shoot it.

The camera is aimed from the critter's own position, so the LOD band is not the
thing under test; what is under test is whether the MODEL is what draws, sits on
its own ground and is lit.

    python _aw_look.py [course ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play  # noqa: E402

AIM = r"""(a) => {
  const G = CRESTBOUND.game, T = CRESTBOUND.THREE;
  const c = (G.course.critters || [])[a.i];
  if (!c) return null;
  const cam = G.cam.camera;
  const h = a.h === undefined ? 1.0 : a.h;
  cam.position.set(c.pos.x + a.dx, c.pos.y + a.dy, c.pos.z + a.dz);
  cam.lookAt(c.pos.x, c.pos.y + h, c.pos.z);
  cam.updateMatrixWorld(true);
  G.cam.update = () => {};
  G.hero.setVisible(false);
  return { kind: c.kind, st: c.state, proc: !!c._procOn, far: !!c._far,
           play: c._clipAction ? c._clipAction.getClip().name : null };
}"""


def run(course):
    with Play("aw_look_" + course) as p:
        p.click_title()
        p.wait(1000)
        p.unlock_all()
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(90):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)"
                        % json.dumps(course)):
                    break
        p.wait(1600)
        for _ in range(60):
            if p.js("() => (CRESTBOUND.game.course.critters||[]).every(c => !!c.model)"):
                break
            p.wait(250)
        n = p.js("() => (CRESTBOUND.game.course.critters||[]).length")
        for i in range(n):
            r = p.js(AIM, {"i": i, "dx": 2.4, "dy": 1.3, "dz": 2.4, "h": 0.7})
            if not r:
                continue
            p.wait(260)
            r2 = p.js(AIM, {"i": i, "dx": 2.4, "dy": 1.3, "dz": 2.4, "h": 0.7})
            p.shot("%02d_%s_%s" % (i, r2["kind"], r2["play"]))
            p.say("%02d %s" % (i, json.dumps(r2)))
        print("SHOTS", p.shotdir)


if __name__ == "__main__":
    for c in (sys.argv[1:] or ["verdant-1", "keep"]):
        run(c)
