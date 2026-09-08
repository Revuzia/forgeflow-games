"""art-wire lane — look at the scarf, modelled vs procedural, same camera.

Freezes the engine, hand-drives the pose, parks a camera behind/beside Nim and
shoots. Run twice: once on the shipping page, once with ?nonim=1 (the
procedural hero), so the two are the SAME frame apart from the body.

    python _aw_scarf.py            # modelled
    python _aw_scarf.py --nonim    # procedural reference
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play, URL  # noqa: E402

SETUP = r"""(a) => {
  const G = CRESTBOUND.game, T = CRESTBOUND.THREE, H = G.hero, P = G.player;
  P.__test.teleport(new T.Vector3(a.x, a.y, a.z));
  P.__test.setFacing(a.yaw);
  return true;
}"""

AIM = r"""(a) => {
  const G = CRESTBOUND.game, T = CRESTBOUND.THREE, H = G.hero;
  const c = G.cam.camera;
  const p = H.root.position;
  c.position.set(p.x + a.dx, p.y + a.dy, p.z + a.dz);
  c.lookAt(p.x, p.y + 0.85, p.z);
  c.updateMatrixWorld(true);
  G.cam.update = () => {};
  return [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)];
}"""


def run(nonim):
    url = URL + ("&nonim=1" if nonim else "")
    tag = "aw_scarf_proc" if nonim else "aw_scarf_glb"
    with Play(tag, url=url) as p:
        p.click_title()
        p.pg.wait_for_timeout(800)
        p.js("() => CRESTBOUND.game.__dev.goto('verdant-1')")
        for _ in range(80):
            if p.js("() => CRESTBOUND.game.course && CRESTBOUND.game.course.def.id === 'verdant-1'"):
                break
            p.pg.wait_for_timeout(250)
        p.pg.wait_for_timeout(1200)
        sp = p.js("() => { const s = CRESTBOUND.game.course.def.spawn.p; return [s[0]+14, s[1]+1, s[2]]; }")
        p.js(SETUP, {"x": sp[0], "y": sp[1], "z": sp[2], "yaw": 0})
        p.pg.wait_for_timeout(900)
        if not nonim:
            for _ in range(120):
                if p.js("() => !!(CRESTBOUND.game.hero && CRESTBOUND.game.hero.glbActive)"):
                    break
                p.pg.wait_for_timeout(250)
        print("glbActive:", p.js("() => !!CRESTBOUND.game.hero.glbActive"))
        # stand still, look from behind and from the side
        p.pg.wait_for_timeout(1500)
        for name, d in (("back", dict(dx=0, dy=1.0, dz=2.6)),
                        ("side", dict(dx=2.4, dy=1.0, dz=0.6)),
                        ("front", dict(dx=0, dy=1.0, dz=-2.6))):
            p.js(AIM, d)
            p.pg.wait_for_timeout(120)
            p.shot("idle_" + name)
        # now run, and shoot mid-stride from behind and the side
        p.down("W")
        p.pg.wait_for_timeout(1400)
        for name, d in (("back", dict(dx=0, dy=1.2, dz=3.0)),
                        ("side", dict(dx=2.8, dy=1.2, dz=0.4))):
            p.js(AIM, d)
            p.pg.wait_for_timeout(100)
            p.shot("run_" + name)
        p.release_all()
        print("shots in", p.shotdir)


if __name__ == "__main__":
    run("--nonim" in sys.argv)
