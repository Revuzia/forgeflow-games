// GENESIS — full-screen pass helper: one oversized triangle, an ortho camera, and a material swap per pass.
// Every post / LUT / atmosphere pass renders through this (no EffectComposer: the HDR chain is custom, §15.2).

import {
  BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, ShaderMaterial, type IUniform, type WebGLRenderer,
  type WebGLRenderTarget, NoBlending, type Blending,
} from 'three';

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class FullscreenQuad {
  readonly mesh: Mesh;
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new Mesh(g);
    this.mesh.frustumCulled = false;
  }

  render(r: WebGLRenderer, mat: ShaderMaterial, target: WebGLRenderTarget | null, layer = 0): void {
    this.mesh.material = mat;
    r.setRenderTarget(target, layer);
    r.render(this.mesh, this.camera);
  }
}

/**
 * every live pass material (macfix/smooth.md F13): passes are drawn outside the scene graph, so Renderer.warmUp's scene
 * compile never saw them, and a pass that runs only in a storm, at night or in a cut-away linked its shader in the frame
 * it first ran. warmUp links them all at load.
 */
export const PASS_MATERIALS = new Set<ShaderMaterial>();

/** a full-screen ShaderMaterial with sane post-process defaults */
export function passMaterial(frag: string, uniforms: Record<string, IUniform>, opts: { blending?: Blending; defines?: Record<string, string | number>; vert?: string } = {}): ShaderMaterial {
  const m = makePass(frag, uniforms, opts);
  PASS_MATERIALS.add(m);
  m.addEventListener('dispose', () => { PASS_MATERIALS.delete(m); });
  return m;
}

function makePass(frag: string, uniforms: Record<string, IUniform>, opts: { blending?: Blending; defines?: Record<string, string | number>; vert?: string }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: opts.vert ?? FS_VERT,
    fragmentShader: frag,
    uniforms,
    defines: opts.defines ?? {},
    depthTest: false,
    depthWrite: false,
    blending: opts.blending ?? NoBlending,
    toneMapped: false,
  });
}
