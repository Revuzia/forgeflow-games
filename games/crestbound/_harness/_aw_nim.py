"""art-wire lane — read the adopted Nim live.

Is the GLB driving THIS rig? Which bones were kept, where is the mesh's
bounding box against the feet, does the scarf move, does a blink close the eye.

    python _aw_nim.py [course]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play  # noqa: E402

PROBE = r"""() => {
  const H = CRESTBOUND.game.hero, T = CRESTBOUND.THREE;
  if (!H) return null;
  const g = H.glb;
  const out = { glbActive: !!H.glbActive, meshes: H._meshes.length,
                bones: H._bones.length };
  if (!g) return out;
  H.root.updateMatrixWorld(true);
  out.adopted = g.meshes.map(m => ({ name: m.name, tris: m.geometry.index
      ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3,
      mat: (Array.isArray(m.material) ? m.material[0] : m.material).name,
      visible: m.visible, bones: m.skeleton.bones.length }));
  out.kept = g.kept.map(b => b.name);
  out.retired = g.retired.map(m => m.name);
  out.scarf = g.scarf.map(b => b.name);
  out.scarfMat = g.scarfMat && g.scarfMat.name;
  out.lensMat = g.lensMat && g.lensMat.name;
  // is the skeleton pointing at THIS file's transforms?
  const sk = g.skeleton;
  out.boneOwn = {};
  for (const n of ['hips','chest','head','handR','footL','upperArmR']) {
    const b = H.bones[n];
    out.boneOwn[n] = sk.bones.indexOf(b) >= 0;
  }
  out.rigIsRig = sk.bones.indexOf(H.rig) >= 0;
  out.eyesIsPivot = sk.bones.indexOf(H._eyePivot) >= 0;
  // world box of the mesh, against the root (feet)
  const box = new T.Box3();
  for (const m of g.meshes) box.expandByObject(m);
  const rp = H.root.position;
  out.box = { minY: +(box.min.y - rp.y).toFixed(3), maxY: +(box.max.y - rp.y).toFixed(3),
              w: +(box.max.x - box.min.x).toFixed(3), d: +(box.max.z - box.min.z).toFixed(3) };
  out.scarfTip = [+H._scarfP[21].toFixed(3), +H._scarfP[22].toFixed(3), +H._scarfP[23].toFixed(3)];
  out.scarfBoneW = g.scarf.map(b => {
    const v = new T.Vector3().setFromMatrixPosition(b.matrixWorld);
    return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  });
  out.pupilRot = g.pupils.map(b => b ? +b.rotation.y.toFixed(4) : null);
  out.eyeScaleY = +H._eyePivot.scale.y.toFixed(3);
  const st = CRESTBOUND.engine.stats;
  out.draws = st.drawCalls; out.tris = st.tris;
  return out;
}"""


def run(course):
    with Play("aw_nim") as p:
        p.click_title()
        p.pg.wait_for_timeout(800)
        if course != "keep":
            p.js("(id) => CRESTBOUND.game.__dev.goto(id)", course)
            for _ in range(80):
                if p.js("() => CRESTBOUND.game.course && CRESTBOUND.game.course.def.id === '%s'" % course):
                    break
                p.pg.wait_for_timeout(250)
        for _ in range(120):
            if p.js("() => !!(CRESTBOUND.game.hero && CRESTBOUND.game.hero.glbActive)"):
                break
            p.pg.wait_for_timeout(250)
        p.pg.wait_for_timeout(1200)
        print(json.dumps(p.js(PROBE), indent=1))
        # scarf must MOVE while running
        a = p.js("() => Array.from(CRESTBOUND.game.hero._scarfP)")
        p.hold(["W"], 1400)
        b = p.js("() => Array.from(CRESTBOUND.game.hero._scarfP)")
        d = sum(abs(x - y) for x, y in zip(a, b))
        print("scarf L1 motion over a 1.4 s run: %.3f m" % d)
        p.shot("nim_run")
        print("console:", [c for c in p.console][:8])


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "verdant-1")
