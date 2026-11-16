// GENESIS — PERF s19 bisection views of the opaque scene pass (debug; both default off, printed in the report header).
//   ?overdraw=1  heat view: every material drawn in the scene pass (layer 0) writes one constant, added up with the
//                depth test off, so a pixel's brightness counts the fragments rasterised over it (dark = 1 layer, brighter with each layer (a constant 0.03 0.01 0.003 per fragment before tonemapping);
//                Alpha-test discards still apply. Read it with the sky and post passes
//                off: `?overdraw=1&atmo=0&clouds=0&water=0&gtao=0&bloom=0&godrays=0&lum=0&fx=0`.
//   ?zpre=1      a depth-only prepass of the terrain (planetview.ts swapZpre, terrainmat.ts makeTerrainZpreMaterial)
//                on layer ZPRE_LAYER before the colour pass.
import { AdditiveBlending, Material, type Object3D, type Scene } from 'three';
import { perfSwitch } from './perfswitch.ts';

export const OVERDRAW = perfSwitch('overdraw', false);
export const ZPRE = perfSwitch('zpre', false);
export const ZPRE_LAYER = 8;

const seen = new WeakSet<Material>();
function patch(m: Material & { isRawShaderMaterial?: boolean }): void {
  if (seen.has(m)) return;
  seen.add(m);
  if (m.isRawShaderMaterial) { m.visible = false; return; }
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  const key = prevKey === Material.prototype.customProgramCacheKey ? prev.toString() : prevKey.call(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    const i = sh.fragmentShader.lastIndexOf('}');
    sh.fragmentShader = `${sh.fragmentShader.slice(0, i)}\n  gl_FragColor = vec4(0.03, 0.01, 0.003, 1.0);\n}${sh.fragmentShader.slice(i + 1)}`;
  };
  m.customProgramCacheKey = () => `${key}-overdraw`;
  m.blending = AdditiveBlending; m.depthTest = false; m.depthWrite = false; m.needsUpdate = true;
}
/** call before the opaque scene render when OVERDRAW: patches every material of a layer-0 object not seen yet */
export function overdrawPatch(scene: Scene): void {
  scene.traverse((o: Object3D & { material?: Material | Material[] }) => {
    if (!(o.layers.mask & 1) || !o.material) return;
    if (Array.isArray(o.material)) o.material.forEach(patch); else patch(o.material);
  });
}
