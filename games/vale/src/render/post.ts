// VALE render — the post chain (STYLE_BIBLE "Grade": N8AO → bloom (threshold 1.0) → tone map →
// LUT → vignette → overlay → SMAA; tokens.json `grade.passOrder`).
//
//   RenderPass(world)                       HalfFloat buffers, renderer.toneMapping = NoToneMapping
//   N8AOPostPass                            ao 1 = half resolution "Medium", ao 2 = full "High"; off on Low; one
//                                           denoise pass instead of two while dynamic resolution holds the scale
//                                           down (r12 B4; a JS-side count: no shader recompiles, no new programs)
//   VfxPass                                 the VFX scene drawn into the HDR buffer (premultiplied, soft
//                                           depth against the stable scene depth), so emissive blooms
//                                           and the grade applies to effects like the world
//   EffectPass(Distort?, Bloom?, Exposure, ToneMapping NEUTRAL, LUT3D vale_grade_01, Grade, Vignette)
//                                           distort: the VFX offset map bends the HDR lookup (≤ 0.015 UV;
//                                           T3/T4 distort layers; not built on Low); bloom: mipmap,
//                                           threshold 1.0, smoothing 0.05, intensity 0.6, radius 0.7 (off
//                                           when video.bloom is false); exposure 1.0 except the ultimate
//                                           impact envelope (vfx/screen.ts: a local eased lift, applied as a
//                                           multiply before tone mapping, never full-screen white; a pixel
//                                           that stands above the ground, read from the stable scene depth,
//                                           takes at most ×1.3 so a struck unit keeps its silhouette);
//                                           tetrahedral LUT on Ultra; grade: the dead player's world eases
//                                           to grey (saturation × value) after the LUT; vignette offset 0.35
//                                           darkness 0.25
//   OverlayPass                             bars, rings, telegraphs, aim — drawn into the GRADED linear
//                                           buffer (no tone map, no LUT), manually depth-tested against
//                                           the scene's stable depth texture, so their hex is the pixel
//   EffectPass(SMAA) | CopyPass             SMAA preset by tier; antialias 'off' ends with a plain copy
//
// The grade (tone map + LUT + vignette) and the overlay are identical on every tier; tiers only
// change AO, bloom, AA, distortion and resolution. The identity LUT stands in until `map.art.lut` loads.
// The exposure envelope and the death grade run on every tier (they are game information, and cheap:
// a few ALU per pixel, early-out when idle).
//
// GPU MEMORY (perf PERF-M1): the chain is built once per quality, never per scene. A scene switch (match setup, the
// return to the menu) only re-points the passes at the new scene and camera; a quality change disposes every pass
// this chain built (render targets, materials, the bloom mip chain, SMAA's lookup textures, N8AO's targets and
// full-screen quads) before it builds the new set. The overlay and VFX passes are the chain's own and survive both.

import {
  type Camera, Color, HalfFloatType, Matrix4, type Scene, type Texture, Uniform, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import {
  BlendFunction, BloomEffect, CopyPass, Effect, EffectComposer, EffectPass, LookupTexture, LUT3DEffect, Pass, RenderPass, SMAAEffect,
  SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MAX_LIFTS, screenFx, screenUniforms } from './vfx/screen.ts';
import { setFogGrade } from './world_material.ts';

export interface PostQuality {
  ao: 0 | 1 | 2;
  bloom: boolean;
  aa: 'off' | 'smaa' | 'msaa';
  tier: 'low' | 'medium' | 'high' | 'ultra';
}

export type OverlayDraw = (renderer: WebGLRenderer, target: WebGLRenderTarget | null, sceneDepth: Texture | null) => void;

/** draws the overlay scene into the graded buffer (no swap); receives the composer's stable depth */
class OverlayPass extends Pass {
  private depth: Texture | null = null;
  private readonly draw: OverlayDraw;
  constructor(draw: OverlayDraw) {
    super('OverlayPass');
    this.draw = draw;
    this.needsSwap = false;
    this.needsDepthTexture = true;
  }
  override setDepthTexture(depthTexture: Texture): void { this.depth = depthTexture; liftDepth.uLiftDepth.value = depthTexture; }
  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.draw(renderer, this.renderToScreen ? null : inputBuffer, this.depth);
  }
}

/** combat F4: the envelope's cap on pixels that stand above the ground (display ratio: units keep their silhouette;
 *  LoL's own hit flash on a champion is 1–2 frames, VALE's light pours onto the ground around the body) */
export const LIFT_BODY_CAP = 1.3;
/** the stable scene depth (the overlay pass's, forwarded) and the camera's matrices the envelope rebuilds height with */
const liftDepth = {
  uLiftDepth: new Uniform<Texture | null>(null),
  uLiftInvProj: new Uniform(new Matrix4()),
  uLiftCamWorld: new Uniform(new Matrix4()),
};

export type VfxDraw = (renderer: WebGLRenderer, target: WebGLRenderTarget | null, sceneDepth: Texture | null, camera: Camera) => void;

const U = screenUniforms;
const uniformsOf = (o: Record<string, Uniform>): Map<string, Uniform> => new Map(Object.entries(o));

/** the ultimate impact envelope (vfx/screen.ts): local eased lift + saturation drop + global dip, HDR. The envelope's
 *  values are DISPLAY brightness ratios (what the eye and a frame capture measure); they multiply linear HDR light
 *  raised to the display gamma (≈ 2.2) so a ×1.45 hold reads ×1.45 on screen below the tone curve's shoulder, and the
 *  peak saturates toward the stopped-sun white only inside the area (never full-screen white).
 *  combat F4: the light pours onto the GROUND. A pixel whose scene point stands above it (rebuilt from the stable depth:
 *  0.15 → 0.45 m up eases in; bodies, structures, props) takes at most LIFT_BODY_CAP and keeps its colour, so the struck
 *  unit reads as a silhouette inside the light instead of going white. Only lit pixels above the cap read the depth. */
class ExposureEffect extends Effect {
  private readonly cam: () => Camera;
  constructor(cam: () => Camera) {
    super('ValeExposure', /* glsl */`
uniform vec4 uLiftA[${MAX_LIFTS}];
uniform vec4 uLiftB[${MAX_LIFTS}];
uniform float uExpo;
uniform float uBreath;
uniform float uAspect;
uniform highp sampler2D uLiftDepth;
uniform float uLiftDepthOn;
uniform mat4 uLiftInvProj;
uniform mat4 uLiftCamWorld;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb * pow( max( uExpo, 0.0 ), 2.2 );
  float lift = 0.0, desat = 0.0;
  for ( int i = 0; i < ${MAX_LIFTS}; i ++ ) {
    vec4 a = uLiftA[ i ];
    if ( a.w <= 0.0 ) continue;
    vec2 d = ( uv - a.xy ) * vec2( uAspect, 1.0 );
    float k = 1.0 - smoothstep( a.z * 0.55, a.z * 1.35, length( d ) );
    lift += a.w * ( k + uBreath * ( 1.0 - k ) );
    desat = max( desat, uLiftB[ i ].x * k );
  }
  if ( lift > ${(LIFT_BODY_CAP - 1).toFixed(3)} && uLiftDepthOn > 0.5 ) {
    float z = texture2D( uLiftDepth, uv ).r;
    vec4 v = uLiftInvProj * vec4( vec3( uv, z ) * 2.0 - 1.0, 1.0 );
    vec3 w = ( uLiftCamWorld * vec4( v.xyz / v.w, 1.0 ) ).xyz;
    float body = smoothstep( 0.15, 0.45, w.y ) * step( z, 0.99999 );
    lift = mix( lift, ${(LIFT_BODY_CAP - 1).toFixed(3)}, body );
    desat *= 1.0 - body;
  }
  c *= pow( 1.0 + lift, 2.2 );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  outputColor = vec4( mix( c, vec3( l ), desat ), inputColor.a );
}`, {
      blendFunction: BlendFunction.SET,
      uniforms: uniformsOf({
        uLiftA: U.uLiftA, uLiftB: U.uLiftB, uExpo: U.uExpo, uBreath: U.uBreath, uAspect: U.uAspect,
        uLiftDepth: liftDepth.uLiftDepth, uLiftDepthOn: new Uniform(0), uLiftInvProj: liftDepth.uLiftInvProj, uLiftCamWorld: liftDepth.uLiftCamWorld,
      }),
    });
    this.cam = cam;
  }
  override update(): void {
    const c = this.cam();
    liftDepth.uLiftInvProj.value.copy(c.projectionMatrixInverse);
    liftDepth.uLiftCamWorld.value.copy(c.matrixWorld);
    this.uniforms.get('uLiftDepthOn')!.value = liftDepth.uLiftDepth.value ? 1 : 0;
  }
}

/** the dead player's grade: saturation and value (after the LUT, before the overlay) */
class GradeEffect extends Effect {
  constructor() {
    super('ValeGrade', /* glsl */`
uniform float uSat;
uniform float uVal;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb;
  if ( uSat < 0.999 || uVal < 0.999 ) {
    float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c = mix( vec3( l ), c, uSat ) * uVal;
  }
  outputColor = vec4( c, inputColor.a );
}`, { blendFunction: BlendFunction.SET, uniforms: uniformsOf({ uSat: U.uSat, uVal: U.uVal }) });
  }
}

/** heat haze / lensing: the VFX distortion offsets bend every later lookup of the HDR buffer */
class DistortEffect extends Effect {
  constructor() {
    super('ValeDistort', /* glsl */`
uniform sampler2D uDistort;
uniform float uDistortOn;
void mainUv( inout vec2 uv ) {
  if ( uDistortOn > 0.5 ) uv += clamp( texture2D( uDistort, uv ).rg, vec2( -0.015 ), vec2( 0.015 ) );
}`, { uniforms: uniformsOf({ uDistort: U.uDistort, uDistortOn: U.uDistortOn }) });
  }
}

/** draws the VFX into the current HDR buffer (no swap) */
class VfxPass extends Pass {
  private depth: Texture | null = null;
  private readonly draw: VfxDraw;
  private readonly cam: () => Camera;
  constructor(draw: VfxDraw, cam: () => Camera) {
    super('VfxPass');
    this.draw = draw;
    this.cam = cam;
    this.needsSwap = false;
    this.needsDepthTexture = true;
  }
  override setDepthTexture(depthTexture: Texture): void { this.depth = depthTexture; }
  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.draw(renderer, inputBuffer, this.depth, this.cam());
  }
}

export class PostChain {
  readonly composer: EffectComposer;
  private scene: Scene;
  private camera: Camera;
  private readonly overlay: OverlayPass;
  private readonly vfx: VfxPass | null;
  private lutTex: Texture;
  private readonly identity: LookupTexture;
  private lutEffect: LUT3DEffect | null = null;
  private quality: PostQuality = { ao: 1, bloom: true, aa: 'smaa', tier: 'high' };
  aoPass: N8AOPostPass | null = null;
  /** the passes build() made (re-pointed on a scene switch, disposed on a quality change) */
  private renderPass: RenderPass | null = null;
  private gradePass: EffectPass | null = null;
  private aaPass: EffectPass | null = null;
  private builtOrtho = false;
  /** r12 B4: AO eased (one denoise pass) while dynamic resolution holds the scale down (renderer.applySize) */
  private aoLow = false;
  private width = 1;
  private height = 1;

  private readonly renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, overlayDraw: OverlayDraw, vfxDraw?: VfxDraw) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, depthBuffer: true, stencilBuffer: false, multisampling: 0 });
    this.overlay = new OverlayPass(overlayDraw);
    this.vfx = vfxDraw ? new VfxPass(vfxDraw, () => this.camera) : null;
    this.identity = LookupTexture.createNeutral(33);
    this.lutTex = this.identity;
    setFogGrade(this.identity);
    this.build();
  }

  /** perf PERF-M1: re-point the built passes (no new targets, materials or programs). Only a change of camera kind
   *  rebuilds: N8AO compiles the projection kind into its programs */
  setScene(scene: Scene, camera: Camera): void {
    this.scene = scene;
    this.camera = camera;
    const ortho = (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
    if (!this.renderPass || ortho !== this.builtOrtho) { this.build(); return; }
    this.renderPass.mainScene = scene;
    this.renderPass.mainCamera = camera;
    if (this.aoPass) {
      const ao = this.aoPass as N8AOPostPass & { scene: Scene; camera: Camera; firstFrame?: () => void };
      ao.scene = scene;
      ao.camera = camera;
      ao.firstFrame?.();
    }
    if (this.gradePass) this.gradePass.mainCamera = camera;
    if (this.aaPass) this.aaPass.mainCamera = camera;
  }

  /** the locked grade; null = identity until the art lane's .cube exists. The fog of war solves its display value
   *  against this grade (env F3: world_material.ts setFogGrade) */
  setLUT(lut: Texture | null): void {
    const next = lut ?? this.identity;
    if (next !== this.lutTex) setFogGrade(next);
    this.lutTex = next;
    if (this.lutEffect) this.lutEffect.lut = this.lutTex;
  }

  setQuality(q: PostQuality): void {
    const same = q.ao === this.quality.ao && q.bloom === this.quality.bloom && q.aa === this.quality.aa && q.tier === this.quality.tier;
    this.quality = { ...q };
    if (!same) this.build();
  }

  /** the dynamic-resolution scale is held down (GPU-bound): AO runs one denoise pass instead of two until it recovers.
   *  Only the pass count changes (N8AO reads it each frame): N8AO's sample counts are compiled into its programs, and
   *  changing them (its 'Low' mode) rebuilt two shaders on the very frame that was already slow */
  setAoLow(low: boolean): void {
    if (low === this.aoLow) return;
    this.aoLow = low;
    if (this.aoPass) this.aoPass.configuration.denoiseIterations = low ? 1 : 2;
  }

  setSize(cssWidth: number, cssHeight: number): void {
    this.width = cssWidth; this.height = cssHeight;
    this.composer.setSize(cssWidth, cssHeight, false);
  }

  render(dt: number): void { this.composer.render(dt); }

  /** every pass this chain built, freed (the overlay and VFX passes are kept: they are re-added) */
  private disposeBuilt(): void {
    for (const p of this.composer.passes) if (p !== this.overlay && p !== this.vfx) disposePass(p);
    this.renderPass = null; this.gradePass = null; this.aaPass = null; this.aoPass = null; this.lutEffect = null;
  }

  private build(): void {
    const c = this.composer;
    this.disposeBuilt();
    c.removeAllPasses();
    const q = this.quality;
    this.builtOrtho = (this.camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    if (q.ao > 0) {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.setQualityMode(q.ao === 2 ? 'High' : 'Medium');
      ao.configuration.denoiseIterations = this.aoLow ? 1 : 2;
      ao.configuration.halfRes = q.ao === 1;
      ao.configuration.aoRadius = 1.4;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.5;
      ao.configuration.color = new Color().setStyle('#1A1C22');
      ao.configuration.gammaCorrection = false;
      c.addPass(ao);
      this.aoPass = ao;
    }
    if (this.vfx) c.addPass(this.vfx);
    const effects: Effect[] = [];
    // distortion: medium and up (never on Low); the VFX system only spawns distort sprites when allowed
    screenFx.distortAllowed = q.tier !== 'low';
    if (screenFx.distortAllowed) effects.push(new DistortEffect());
    if (q.bloom) {
      effects.push(new BloomEffect({
        mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.05, intensity: 0.6, radius: 0.7,
        levels: q.tier === 'medium' ? 6 : 8,
      }));
    }
    effects.push(new ExposureEffect(() => this.camera));
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }));
    this.lutEffect = new LUT3DEffect(this.lutTex, { tetrahedralInterpolation: q.tier === 'ultra' || q.tier === 'high' });
    effects.push(this.lutEffect);
    effects.push(new GradeEffect());
    effects.push(new VignetteEffect({ offset: 0.35, darkness: 0.25 }));
    this.gradePass = new EffectPass(this.camera, ...effects);
    c.addPass(this.gradePass);
    c.addPass(this.overlay);
    if (q.aa === 'off') {
      c.addPass(new CopyPass());
    } else {
      const preset = q.tier === 'ultra' ? SMAAPreset.ULTRA : q.tier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM;
      this.aaPass = new EffectPass(this.camera, new SMAAEffect({ preset }));
      c.addPass(this.aaPass);
    }
  }

  dispose(): void { this.composer.dispose(); this.identity.dispose(); }
}

/** free one built pass: Pass.dispose frees its render targets, materials, textures, sub-passes and (EffectPass) its
 *  effects; N8AO's full-screen quads hold their own materials outside that shallow search, so they go explicitly */
function disposePass(p: Pass): void {
  p.dispose();
  for (const v of Object.values(p as unknown as Record<string, unknown>)) {
    const q = v as { _mesh?: unknown; dispose?: () => void } | null;
    if (q && typeof q === 'object' && q._mesh && typeof q.dispose === 'function') q.dispose();
  }
}
