// foes-view scratch: near (rest-pose multi-part) vs far LOD (buildFoeFar) for every enemy kind.
// Row 1: near · Row 2: far (large). Right half: the same pairs rendered tiny (≈ Size IV–V pixels).
import * as THREE from 'three';
import { ENEMY_KINDS } from '../../../src/core/types.ts';
import { buildFoeFar, buildFoeModel, makeFoeMaterial, PIV_STRIDE } from '../../../src/ai/foemodels.ts';
import type { FoeModel } from '../../../src/ai/foemodels.ts';

const cv = document.getElementById('c') as HTMLCanvasElement;
const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
R.setSize(1280, 720, false);
R.setClearColor('#4a8f8a');
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.4));
const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(3, 6, 4); scene.add(sun);
const mat = makeFoeMaterial(false);
mat.userData.bt.uGlowMul.value = 1;

function nearGroup(m: FoeModel): THREE.Group {
  const g = new THREE.Group();
  const world: THREE.Matrix4[][] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (const part of m.parts) {
    const mats: THREE.Matrix4[] = [];
    for (let k = 0; k < part.count; k++) {
      const o = k * PIV_STRIDE;
      p.set(part.piv[o], part.piv[o + 1], part.piv[o + 2]);
      q.setFromEuler(e.set(0, part.piv[o + 3], 0, 'YXZ'));
      const L = new THREE.Matrix4().compose(p, q, one);
      const par = part.parent < 0 ? null : world[part.parent][m.parts[part.parent].count === part.count ? k : 0];
      const W = par ? new THREE.Matrix4().multiplyMatrices(par, L) : L;
      mats.push(W);
      const mesh = new THREE.Mesh(part.geo, mat);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(W);
      g.add(mesh);
    }
    world.push(mats);
  }
  return g;
}

const kinds = ENEMY_KINDS;
const CELLS = Number(new URLSearchParams(location.search).get('cells') ?? 10);
const tiny = new THREE.Scene();
tiny.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.4));
const sun2 = sun.clone(); tiny.add(sun2);
let label = '';
kinds.forEach((k, i) => {
  const m = buildFoeModel(k);
  const bb = new THREE.Box3().setFromBufferAttribute(buildFoeFar(m, CELLS).getAttribute('position') as THREE.BufferAttribute); const sz = bb.getSize(new THREE.Vector3()); const s = 1.1 / Math.max(sz.x, sz.y, sz.z);
  const near = nearGroup(m); near.scale.setScalar(s); near.position.set(i * 1.06, 1.1, -i * 1.06);
  const farG = buildFoeFar(m, CELLS);
  const far = new THREE.Mesh(farG, mat); far.scale.setScalar(s); far.position.set(i * 1.06, -0.3, -i * 1.06);
  scene.add(near, far);
  const n2 = near.clone(); const f2 = far.clone(); tiny.add(n2, f2);
  let nt = 0; for (const p of m.parts) nt += (p.geo.getAttribute('position').count / 3) * p.count;
  label += `${k}: ${nt} → ${farG.getAttribute('position').count / 3} tris\n`;
});
(document.getElementById('label') as HTMLElement).textContent = label;
const cam = new THREE.OrthographicCamera(-1, 11.4, 2, -1.6, 0.1, 100);
cam.position.set(3.7 + 6, 6.4, -3.7 + 6); cam.lookAt(3.7, 0.4, -3.7);
// tiny view: same framing, rendered into a 1/12-size target then blown up (nearest)
const rt = new THREE.WebGLRenderTarget(107, 60);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: rt.texture }));
rt.texture.magFilter = THREE.NearestFilter;
const oscene = new THREE.Scene(); oscene.add(quad);
const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let n = 0;
function frame(): void {
  R.setRenderTarget(null);
  R.setViewport(0, 360, 1280, 360); R.setScissor(0, 360, 1280, 360); R.setScissorTest(true);
  cam.left = -6.0; cam.right = 6.0; cam.top = 1.6; cam.bottom = -1.8; cam.updateProjectionMatrix();
  R.render(scene, cam);
  R.setRenderTarget(rt); R.setViewport(0, 0, 107, 60); R.setScissorTest(false);
  R.render(tiny, cam);
  R.setRenderTarget(null);
  R.setViewport(0, 0, 1280, 360); R.setScissor(0, 0, 1280, 360); R.setScissorTest(true);
  R.render(oscene, ocam);
  if (++n > 5) (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
  requestAnimationFrame(frame);
}
frame();
