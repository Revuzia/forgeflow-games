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

/** a full-screen ShaderMaterial with sane post-process defaults */
export function passMaterial(frag: string, uniforms: Record<string, IUniform>, opts: { blending?: Blending; defines?: Record<string, string | number>; vert?: string } = {}): ShaderMaterial {
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
