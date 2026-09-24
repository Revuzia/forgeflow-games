// BLOCKTOOTH — shader/texture warm-up before frame 1 (CONTRACT.md §6, doctrine §3).
// render-core lane.
//
// Programs are keyed per render-target variant: an RT-bound render uses linear output + no
// tone mapping, the canvas uses sRGB + NeutralToneMapping, and shadow-depth programs only link
// during a real shadow pass. So:
//   1. force every object visible (incl. hidden children), every empty InstancedMesh to
//      count ≥ 1 and every mesh to frustumCulled = false, remembering what we changed — so the
//      warm frame draws (and shadow-casts) EVERYTHING, not just what the boot camera sees;
//   2. compileAsync with a HalfFloat RT bound, then RENDER one frame into it (links the
//      shadow-depth variants of every caster and uploads every texture/geometry/instance buffer);
//   3. compileAsync again for the canvas (sRGB + tone-mapping variants);
//   4. restore visibility / counts / culling / render target / autoClear exactly.
// Outline hulls (addOutline) mirror their source's count + frustumCulled by accessor, so they
// are skipped (their setters are no-ops by design).

import * as THREE from 'three';

interface Forced { o: THREE.Object3D; visible: boolean; count: number | null; culled: boolean | null; }

export async function warmup(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  const forced: Forced[] = [];
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    const isHull = o.userData && o.userData.isOutline === true;
    const needCount = im.isInstancedMesh === true && !isHull && im.count === 0 && im.instanceMatrix && im.instanceMatrix.count > 0;
    const isDrawable = (o as THREE.Mesh).isMesh === true || (o as THREE.Points).isPoints === true || (o as THREE.Line).isLine === true;
    const needCull = isDrawable && !isHull && o.frustumCulled === true;
    if (!o.visible || needCount || needCull) {
      forced.push({ o, visible: o.visible, count: needCount ? 0 : null, culled: needCull ? true : null });
      o.visible = true;
      if (needCount) im.count = 1;
      if (needCull) o.frustumCulled = false;
    }
  });

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
  rt.texture.name = 'warmupRT';
  try {
    // 1) RT-bound variants (linear output, no tone mapping)
    renderer.setRenderTarget(rt);
    await renderer.compileAsync(scene, camera);
    // a real frame: shadow-depth programs, texture + geometry + instance-buffer uploads
    renderer.setRenderTarget(rt);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    // 2) canvas variants (sRGB + tone mapping)
    renderer.setRenderTarget(null);
    await renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    for (let i = forced.length - 1; i >= 0; i--) {
      const f = forced[i];
      f.o.visible = f.visible;
      if (f.count !== null) (f.o as THREE.InstancedMesh).count = f.count;
      if (f.culled !== null) f.o.frustumCulled = f.culled;
    }
    rt.dispose();
  }
}
