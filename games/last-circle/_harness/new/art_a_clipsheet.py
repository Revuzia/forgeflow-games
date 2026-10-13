#!/usr/bin/env python
"""art_a_clipsheet.py - ART-A visual proof: a contact sheet of the seven Mixamo death clips (assets/chars/clips/death_*.glb) on a
real skin (default soldier), rendered in a real Chrome with the game's own GLTFLoader + three.  One row per clip, columns =
t 0 / 35 % / 70 % / 100 % from a 3/4 view and the final pose from straight above, on a flat grey ground plane at y = 0 so a body
sunk into the floor is visible.  Writes the PNG sheet; always exit 0 unless the browser cannot start (2).

  python _harness/new/art_a_clipsheet.py --disk --sheet <sheet.png> [--skin soldier] [--clips death_front,death_back,...] [--old death]
"""
from __future__ import annotations

import argparse
import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common  # noqa: E402
from common import Session, add_common_args, run_gate  # noqa: E402

JS = r"""
async (cfg) => {
  const THREE = await import('three');
  const W = window.__LC__.W, loader = W.kernel.loader, base = W.assetBase;
  const _rbM = new THREE.Matrix4(), _rbQ = new THREE.Quaternion(), _rbV = new THREE.Vector3(), _rbS = new THREE.Vector3(), _rbK = new THREE.Quaternion();
  const rootBone = (scene) => { let r = null; scene.traverse((o) => { if (!r && (o.isBone || /Hips$/.test(o.name)) && /(^|:)?(mixamorig:?)?Hips$/i.test(o.name)) r = o; }); return r; };
  const isRoot = (n) => /(^|:|\|)(Hips|Root|Armature|mixamorig:?Hips)$/i.test(n);
  function rebase(clip, srcScene, baseScene) {
    const src = rootBone(srcScene), bse = rootBone(baseScene); if (!src || !bse || !src.parent || !bse.parent) return;
    srcScene.updateMatrixWorld(true); baseScene.updateMatrixWorld(true);
    _rbM.copy(bse.parent.matrixWorld).invert().multiply(src.parent.matrixWorld);
    const e = _rbM.elements; let id = true; for (let i = 0; i < 16; i++) if (Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) { id = false; break; }
    if (id) return; _rbM.decompose(_rbV, _rbQ, _rbS);
    for (const tr of clip.tracks) {
      if (tr.name === src.name + '.position') { const v = tr.values; for (let i = 0; i < v.length; i += 3) { _rbV.fromArray(v, i).applyMatrix4(_rbM); _rbV.toArray(v, i); } }
      else if (tr.name === src.name + '.quaternion') { const v = tr.values; for (let i = 0; i < v.length; i += 4) { _rbK.fromArray(v, i).premultiply(_rbQ); _rbK.toArray(v, i); } }
    }
  }
  function strip(clip) {
    clip.tracks = clip.tracks.filter((tr) => { const m = /\.(position|scale)$/.exec(tr.name || ''); return !m || isRoot(tr.name.slice(0, -m[0].length)); });
    for (const tr of clip.tracks) {
      if (!/\.position$/.test(tr.name)) continue; const v = tr.values; const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      let s = 0; for (let i = 1; i < v.length; i += 3) s += v[i]; const mean = s / (v.length / 3);
      if (mean > 3 || (mean > 1e-6 && mean < 0.2)) { const f = 0.99 / mean; for (let i = 1; i < v.length; i += 3) v[i] *= f; }
    }
  }
  const sg = await loader.loadAsync(base + 'assets/chars/meshy/' + cfg.skin + '.glb');
  const body = sg.scene;
  body.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; const m = o.material; if (m && m.emissiveMap) { m.emissiveMap = null; m.emissive && m.emissive.setHex(0); } } });
  const W_ = cfg.cell[0], H_ = cfg.cell[1];
  const cv = document.createElement('canvas'); cv.width = W_; cv.height = H_;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W_, H_, false); renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbcd4e6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 6, 4); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: 1, side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(8, 16, 0x444444, 0x666666); grid.position.y = 0.002; scene.add(grid);
  scene.add(body);
  const cam = new THREE.PerspectiveCamera(36, W_ / H_, 0.1, 50);
  const mesh = (() => { let m = null; body.traverse((o) => { if (!m && o.isSkinnedMesh) m = o; }); return m; })();
  const shots = [];
  const snap = () => { renderer.render(scene, cam); return cv.toDataURL('image/png'); };
  for (const spec of cfg.clips) {
    const g = spec.old ? await loader.loadAsync(base + 'assets/chars/meshy/' + cfg.skin + '_' + spec.name + '.glb') : await loader.loadAsync(base + 'assets/chars/clips/' + spec.name + '.glb');
    const c = g.animations[0].clone(); c.name = spec.name; rebase(c, g.scene, sg.scene); strip(c);
    const names = new Set(); body.traverse((o) => names.add(o.name));
    c.tracks = c.tracks.filter((t) => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    const mx = new THREE.AnimationMixer(body); const a = mx.clipAction(c); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    const frames = [];
    for (const f of [0, 0.35, 0.7, 1]) {
      mx.setTime(Math.min(c.duration * f, c.duration - 1e-4 * (f === 1 ? 0 : 1))); body.updateMatrixWorld(true);
      cam.position.set(-2.6, 1.9, 3.3); cam.lookAt(0, 0.55, 0); cam.updateMatrixWorld();
      frames.push(snap());
    }
    cam.position.set(0.01, 4.3, 0.2); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    frames.push(snap());
    // lowest vertex at the end (full pass)
    mesh.skeleton.update(); const v = new THREE.Vector3(); let lo = 1e9; const n = mesh.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y < lo) lo = v.y; }
    shots.push({ name: spec.name, frames, endMinVertY: lo });
    mx.stopAllAction(); mx.uncacheClip(c); mx.uncacheRoot(body); if (mesh) mesh.skeleton.pose();
  }
  renderer.dispose();
  return shots;
}
"""


def main(v):
    a = v.args
    clips = [{"name": c, "old": False} for c in a.clips.split(",") if c]
    if a.old:
        clips.append({"name": a.old, "old": True})
    cell = (a.cell_w, a.cell_h)
    with Session(a, name="art_a_clipsheet") as s:
        s.boot()
        s.freeze_loop()   # the game's own rAF render would fight this page's second WebGL context
        shots = s.js(JS, {"skin": a.skin, "clips": clips, "cell": list(cell)})
        from PIL import Image, ImageDraw
        cols = 5
        sheet = Image.new("RGB", (cols * cell[0], len(shots) * cell[1]), (30, 30, 30))
        d = ImageDraw.Draw(sheet)
        for r, sh in enumerate(shots):
            for c, url in enumerate(sh["frames"]):
                png = base64.b64decode(url.split(",", 1)[1])
                p = os.path.join(os.path.dirname(a.sheet), "_cell.png")
                with open(p, "wb") as f:
                    f.write(png)
                im = Image.open(p).convert("RGB")
                sheet.paste(im, (c * cell[0], r * cell[1]))
            d.rectangle([0, r * cell[1], 330, r * cell[1] + 16], fill=(0, 0, 0))
            d.text((4, r * cell[1] + 2), "%s  %s  end lowest vertex y %.3f m" % (a.skin, sh["name"], sh["endMinVertY"]), fill=(255, 255, 255))
            v.info(sh["name"], "end lowest vertex y %.3f" % sh["endMinVertY"])
        try:
            os.remove(os.path.join(os.path.dirname(a.sheet), "_cell.png"))
        except OSError:
            pass
        sheet.save(a.sheet)
        v.note("wrote %s (%dx%d)" % (a.sheet, sheet.width, sheet.height))
        d2 = s.diagnostics()
        v.check("0 page errors / console errors / failed requests", not (d2["pageErrors"] or d2["windowErrors"] or d2["consoleErrors"] or d2["failedRequests"]), "clean")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    add_common_args(ap)
    ap.add_argument("--skin", default="soldier")
    ap.add_argument("--clips", default="death_front,death_front_head,death_back,death_back_head,death_right,death_crouch_head,death_walking")
    ap.add_argument("--old", default="death", help="also render this OLD per-skin clip as a reference row ('' = none)")
    ap.add_argument("--cell-w", type=int, default=240)
    ap.add_argument("--cell-h", type=int, default=240)
    ap.add_argument("--sheet", required=True, help="output PNG path")
    a = ap.parse_args()
    sys.exit(run_gate("art_a_clipsheet", main, a))
