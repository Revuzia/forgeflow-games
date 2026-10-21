// VALE render — the hover rim (r12 B1; tokens.json `hud.unitOutline.hover*`). Overlay pass: after the grade, so
// the rim is the exact relationship hex on screen (HARM for enemies and neutrals, ally azure for allies), with
// the overlay's 1 px dark keyline outside it (the rings' and telegraphs' keyline, STYLE_BIBLE "HUD density").
//
// A clean silhouette, never the inverted hull's interior seams or back-face specks:
//   1. mask   the hovered unit's body (its hull geometry, front and back faces, every pixel, occluded or not)
//             into an R8 target;
//   2. rim    the same hull pushed out by the rim width in screen px (back faces), drawn only OUTSIDE the mask
//             and depth-tested by hand against the scene depth (a unit or wall in front hides it; the feet keep
//             their rim on the ground they stand on). First the keyline at width + 1 px in ink, then the rim.
// The meshes are the actor's prebuilt hull copies (actors.ts buildHull), restyled for the draw and restored:
// hovering never adds a node to the scene graph. One hovered unit at a time, so the cost is a handful of draws
// and one R8 clear per frame while something is hovered, nothing otherwise.

import {
  BackSide, type Camera, type Color, DoubleSide, type Material, type Mesh, NormalBlending, type Object3D, RedFormat, type Scene, ShaderMaterial,
  UnsignedByteType, WebGLRenderTarget, type WebGLRenderer, NearestFilter, Color as ThreeColor,
} from 'three';
import { DEPTH_TEST_GLSL, overlayUniforms } from './context.ts';
import { outlineUniforms } from '../actors.ts';

/** camera layers the restyled hull copies render on (the match camera only ever draws layer 0) */
const MASK_LAYER = 29;
const RIM_LAYER = 30;
/** metres a rim fragment may sit behind the scene surface and still draw (the ground at a unit's feet) */
const FEET_BIAS_M = 0.45;
const KEYLINE_ALPHA = 0.45;

export interface HoverTarget {
  readonly model: Object3D;
  /** the body's silhouette meshes (hull geometry, unexpanded) */
  readonly mask: readonly Mesh[];
  /** the outline hull meshes (expanded by the vertex shader) */
  readonly hull: readonly Mesh[];
  readonly px: number;
  readonly color: Color;
  /** the target's own programs (the instanced crowd skins on the GPU from baked rows): MASK_FRAG and RIM_FRAG over
   *  its own vertex stage, with hoverRimUniforms(); default: three-skinned meshes */
  readonly maskMat?: Material;
  readonly rimMat?: ShaderMaterial;
}

const SKIN_VERT_HEAD = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
`;

const MASK_VERT = /* glsl */`${SKIN_VERT_HEAD}
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;

const RIM_VERT = /* glsl */`${SKIN_VERT_HEAD}
uniform float uPx;
uniform vec2 uOutlineRes;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  // screen-space push along the view normal (never flipped for the back faces drawn here)
  vec3 vn = normalize( normalMatrix * objectNormal );
  vec2 dir = normalize( ( projectionMatrix * vec4( vn, 0.0 ) ).xy + 1e-5 );
  gl_Position.xy += dir * uPx * 2.0 / uOutlineRes * gl_Position.w;
}`;

export const MASK_FRAG = 'void main() { gl_FragColor = vec4( 1.0 ); }';

/** the rim pass' uniforms (uPx, uColor, uAlpha, uMask + the overlay's scene-depth test) */
export function hoverRimUniforms(): Record<string, { value: unknown }> {
  return {
    uPx: { value: 2.5 }, uMask: { value: null }, uColor: { value: new ThreeColor() }, uAlpha: { value: 1 },
    uSceneDepth: overlayUniforms.uSceneDepth, uHasDepth: overlayUniforms.uHasDepth, uResolution: overlayUniforms.uResolution,
    uNear: overlayUniforms.uNear, uFar: overlayUniforms.uFar,
  };
}

export const RIM_FRAG = /* glsl */`
${DEPTH_TEST_GLSL}
uniform sampler2D uMask;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  if ( texture( uMask, gl_FragCoord.xy / uResolution ).r > 0.5 ) discard;
  float a = uAlpha * valeVisible( ${FEET_BIAS_M.toFixed(2)} );
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( uColor, a );
}`;

interface Saved { mesh: Mesh; material: Material | Material[]; visible: boolean; layers: number }

export class HoverOutline {
  private target: WebGLRenderTarget | null = null;
  private readonly maskMat: ShaderMaterial;
  private readonly rimMat: ShaderMaterial;
  private readonly ink = new ThreeColor(0, 0, 0);
  private readonly saved: Saved[] = [];

  constructor(inkHex: string) {
    this.ink.setStyle(inkHex);
    this.maskMat = new ShaderMaterial({
      vertexShader: MASK_VERT, fragmentShader: MASK_FRAG,
      side: DoubleSide, depthTest: false, depthWrite: false, fog: false,
    });
    this.rimMat = new ShaderMaterial({
      vertexShader: RIM_VERT, fragmentShader: RIM_FRAG,
      uniforms: { ...hoverRimUniforms(), uOutlineRes: outlineUniforms.uOutlineRes },
      side: BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: NormalBlending,
    });
  }

  /** draw the rim of `t` into `out` (the overlay pass' graded buffer); call inside OverlayContext.draw */
  draw(r: WebGLRenderer, cam: Camera, out: ReturnType<WebGLRenderer['getRenderTarget']>, t: HoverTarget): void {
    if (t.px <= 0 || !t.mask.length || !t.hull.length) return;
    const res = overlayUniforms.uResolution.value;
    const w = Math.max(1, Math.round(res.x)), h = Math.max(1, Math.round(res.y));
    if (!this.target) {
      this.target = new WebGLRenderTarget(w, h, { format: RedFormat, type: UnsignedByteType, depthBuffer: false, stencilBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
    } else if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const layers = cam.layers.mask;
    const clear = r.getClearColor(new ThreeColor()), clearA = r.getClearAlpha(), autoClear = r.autoClear;
    r.autoClear = false;
    // 1) silhouette mask
    const maskMat = t.maskMat ?? this.maskMat, rimMat = t.rimMat ?? this.rimMat;
    this.restyle(t.mask, maskMat, MASK_LAYER);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    cam.layers.set(MASK_LAYER);
    r.render(t.model, cam);
    this.restore();
    // 2) keyline (width + 1 px, ink) then the rim, outside the mask
    const u = rimMat.uniforms;
    u.uMask.value = this.target.texture;
    this.restyle(t.hull, rimMat, RIM_LAYER);
    r.setRenderTarget(out);
    cam.layers.set(RIM_LAYER);
    u.uPx.value = t.px + 1; (u.uColor.value as ThreeColor).copy(this.ink); u.uAlpha.value = KEYLINE_ALPHA;
    r.render(t.model, cam);
    u.uPx.value = t.px; (u.uColor.value as ThreeColor).copy(t.color); u.uAlpha.value = 1;
    r.render(t.model, cam);
    this.restore();
    cam.layers.mask = layers;
    r.setClearColor(clear, clearA);
    r.autoClear = autoClear;
  }

  /**
   * Compile the mask and rim programs for this kind of target (skinned or rigid hull) in parallel
   * (KHR_parallel_shader_compile), so the first hover of a match never stalls on a shader link. The meshes are
   * restyled only for the synchronous part of compileAsync (program creation), then restored.
   */
  prewarm(r: WebGLRenderer, cam: Camera, scene: Scene, t: Pick<HoverTarget, 'mask' | 'hull'>): void {
    if (!t.mask.length || !t.hull.length) return;
    this.restyle(t.mask.slice(0, 1), this.maskMat, MASK_LAYER);
    this.restyle(t.hull.slice(0, 1), this.rimMat, RIM_LAYER);
    // the two leaf meshes only (compiling the whole model in a light-less scene would build unused body variants)
    try {
      void r.compileAsync(t.mask[0], cam, scene).catch(() => undefined);
      void r.compileAsync(t.hull[0], cam, scene).catch(() => undefined);
    } finally { this.restore(); }
  }

  private restyle(meshes: readonly Mesh[], mat: Material, layer: number): void {
    for (const m of meshes) {
      this.saved.push({ mesh: m, material: m.material, visible: m.visible, layers: m.layers.mask });
      m.material = mat; m.visible = true; m.layers.set(layer);
    }
  }

  private restore(): void {
    for (const s of this.saved) { s.mesh.material = s.material; s.mesh.visible = s.visible; s.mesh.layers.mask = s.layers; }
    this.saved.length = 0;
  }

  dispose(): void { this.target?.dispose(); this.maskMat.dispose(); this.rimMat.dispose(); }
}
