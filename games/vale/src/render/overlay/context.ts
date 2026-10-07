// VALE render — overlay context (STYLE_BIBLE "Palette": overlays draw after the grade, so every hex
// is the screen pixel; tokens.json `hud.telegraph.pass` = overlay, after LUT and vignette,
// depth-tested, before SMAA).
//
// Two scenes:
//   teleScene  telegraphs + aim indicators, rendered into a cleared HalfFloat target with MAX
//              blending (overlaps never stack: "overlaps MAX-capped at 40 %"), premultiplied;
//   scene      the telegraph composite (premultiplied over), ground rings, hover outlines, overhead
//              bars — drawn straight into the graded buffer.
// World-anchored overlay pieces are depth-tested MANUALLY against the composer's stable scene depth
// (units standing on a ring hide it; a cliff hides a telegraph behind it), so the pass works no
// matter which ping-pong buffer holds the graded image.

import {
  type Camera, Color, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, type PerspectiveCamera, Scene,
  ShaderMaterial, type Texture, Vector2, WebGLRenderTarget, type WebGLRenderer, CustomBlending, OneFactor,
  OneMinusSrcAlphaFactor, AddEquation, LinearFilter,
} from 'three';

export const overlayUniforms = {
  uSceneDepth: { value: null as Texture | null },
  uHasDepth: { value: 0 },
  uResolution: { value: new Vector2(1920, 1080) },
  uPxRatio: { value: 1 },          // buffer px per CSS px
  uBarScale: { value: 1 },         // overhead bar scale (720p floor 0.8 × hud scale)
  uNear: { value: 1 },
  uFar: { value: 400 },
  uTime: { value: 0 },
};

/** GLSL: manual scene-depth test (perspective depth), in metres */
export const DEPTH_TEST_GLSL = /* glsl */`
uniform sampler2D uSceneDepth;
uniform float uHasDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
float valeLinDepth( float d ) {
  float z = d * 2.0 - 1.0;
  return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
}
// 1 when this fragment is in front of the scene (or within bias metres behind it)
float valeVisible( float biasM ) {
  if ( uHasDepth < 0.5 ) return 1.0;
  float sd = texture( uSceneDepth, gl_FragCoord.xy / uResolution ).r;
  float s = valeLinDepth( sd ), f = valeLinDepth( gl_FragCoord.z );
  return 1.0 - smoothstep( biasM, biasM + 0.12, f - s );
}
`;

export class OverlayContext {
  readonly scene = new Scene();
  readonly teleScene = new Scene();
  private teleTarget: WebGLRenderTarget;
  private readonly compositeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composite: Mesh;
  private readonly clear = new Color(0, 0, 0);
  camera: PerspectiveCamera | null = null;

  constructor() {
    this.scene.matrixWorldAutoUpdate = true;
    this.teleTarget = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false, stencilBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter });
    const mat = new ShaderMaterial({
      uniforms: { tTele: { value: this.teleTarget.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: 'uniform sampler2D tTele; varying vec2 vUv; void main(){ gl_FragColor = texture2D( tTele, vUv ); }',
      depthTest: false, depthWrite: false, transparent: true,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.composite = new Mesh(new PlaneGeometry(2, 2), mat);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -100;
    this.scene.add(this.composite);
  }

  /** the overlay pass body (post.ts OverlayPass) */
  draw(renderer: WebGLRenderer, target: WebGLRenderTarget | null, sceneDepth: Texture | null, layerDraw?: (camera: Camera) => void): void {
    const cam = this.camera;
    if (!cam) return;
    const w = target ? target.width : renderer.domElement.width;
    const h = target ? target.height : renderer.domElement.height;
    overlayUniforms.uResolution.value.set(w, h);
    overlayUniforms.uSceneDepth.value = sceneDepth;
    overlayUniforms.uHasDepth.value = sceneDepth ? 1 : 0;
    overlayUniforms.uNear.value = cam.near;
    overlayUniforms.uFar.value = cam.far;
    if (this.teleTarget.width !== w || this.teleTarget.height !== h) this.teleTarget.setSize(w, h);
    const autoClear = renderer.autoClear;
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    // 1) telegraphs → MAX target
    renderer.setRenderTarget(this.teleTarget);
    renderer.setClearColor(this.clear, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.teleScene, cam);
    // 2) composite + rings + bars → the graded buffer
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    layerDraw?.(cam);
    renderer.autoClear = autoClear;
    renderer.setClearColor(prevClear, prevAlpha);
  }

  dispose(): void {
    this.teleTarget.dispose();
    this.composite.geometry.dispose();
    (this.composite.material as ShaderMaterial).dispose();
  }
}

export const _compositeCam = OrthographicCamera;
