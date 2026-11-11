// VALE render — the post chain (STYLE_BIBLE "Grade": N8AO → bloom (threshold 1.0) → tone map →
// LUT → vignette → overlay → SMAA; tokens.json `grade.passOrder`).
//
//   RenderPass(world)                       HalfFloat buffers, renderer.toneMapping = NoToneMapping
//   N8AOPostPass                            ao 1 = half resolution "Medium", ao 2 = half resolution "High" (perf
//                                           PERF-C1: full-resolution AO cost Ultra 1080p 25 fps on the M5 — 34.8 fps vs
//                                           60.1 at half resolution, A/B in one page; the "High" samples keep Ultra's
//                                           finer contact shading); off on Low; one
//                                           denoise pass instead of two while dynamic resolution holds the scale
//                                           down (r12 B4; a JS-side count: no shader recompiles, no new programs)
//   VfxPass                                 the VFX scene drawn into the HDR buffer (premultiplied, soft
//                                           depth against the stable scene depth), so emissive blooms
//                                           and the grade applies to effects like the world
//   EffectPass(Distort?, Bloom?, Exposure, ToneMapping NEUTRAL, LUT3D (map.art.lut: vale_grade_<map>, ENV-8), Grade, Vignette)
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
//   EffectPass(SMAA + sharpen) | CopyPass   SMAA preset by tier; antialias 'off' ends with a plain copy. High and Ultra
//                                           fold a contrast-adaptive sharpen (CAS-style, VALE's own, 4 taps) into the SMAA
//                                           program (max env ENV-9: SMAA softened the ground micro detail and the crown
//                                           plate edges); a uniform, so the program count stays the same; hard edges
//                                           (outlines, overlay rings and bars, UI rims) fade it out (the halo guard)
//
// The grade (tone map + LUT + vignette) and the overlay are identical on every tier; tiers only
// change AO, bloom, AA, distortion and resolution. The identity LUT stands in until `map.art.lut` loads.
// The one stand-in: with bloom off an ultimate's envelope lifts a little more and the light effects add inside it takes a
// fixed gain (NO_BLOOM_LIFT_GAIN, NO_BLOOM_FX_GAIN): uniforms, no extra pass.
// The exposure envelope and the death grade run on every tier (they are game information, and cheap:
// a few ALU per pixel, early-out when idle).
//
// GPU MEMORY (perf PERF-M1): the chain is built once per quality, never per scene. A scene switch (match setup, the
// return to the menu) only re-points the passes at the new scene and camera; a quality change disposes every pass
// this chain built (render targets, materials, the bloom mip chain, SMAA's lookup textures, N8AO's targets and
// full-screen quads) before it builds the new set. The overlay and VFX passes are the chain's own and survive both.

import {
  type Camera, Color, HalfFloatType, Matrix4, NearestFilter, type Scene, type Texture, Uniform, type WebGLRenderer, WebGLRenderTarget,
} from 'three';
import {
  BlendFunction, BloomEffect, CopyPass, Effect, EffectComposer, EffectPass, LookupTexture, LUT3DEffect, Pass, RenderPass, SMAAEffect,
  SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { LIFT_BODY_CAP, LIFT_GROUND_TOP, MAX_LIFTS, screenFx, screenUniforms } from './vfx/screen.ts';
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

/** combat F4: the envelope's cap on pixels that stand above the ground (vfx/screen.ts; the VFX light takes it too) */
export { LIFT_BODY_CAP };
/** the stable scene depth (the overlay pass's, forwarded) and the camera's matrices the envelope rebuilds height with */
const liftDepth = {
  uLiftDepth: new Uniform<Texture | null>(null),
  /** CW1 refix (combat C1): the world as it stood BEFORE the VFX were drawn (VfxPass blits it while an envelope lifts),
   *  so the ground's tone-curve solve reads the ground alone and the effects' own light is never re-solved with it */
  uLiftPre: new Uniform<Texture | null>(null),
  uLiftPreOn: new Uniform(0),
  /** CW1 r2 refix 1 (B5 flash): the gains on an envelope's local lift and on the effects' own light inside it (1 with bloom) */
  uLiftGain: new Uniform(1),
  uLiftFxGain: new Uniform(1),
  uLiftInvProj: new Uniform(new Matrix4()),
  uLiftCamWorld: new Uniform(new Matrix4()),
};

export type VfxDraw = (renderer: WebGLRenderer, target: WebGLRenderTarget | null, sceneDepth: Texture | null, camera: Camera) => void;

const U = screenUniforms;
/** CW1 r2 refix 1: what an ultimate's envelope gains when the chain has no bloom: its local lift, and the light effects add */
const NO_BLOOM_LIFT_GAIN = 1.2;
const NO_BLOOM_FX_GAIN = 2;
const uniformsOf = (o: Record<string, Uniform>): Map<string, Uniform> => new Map(Object.entries(o));

/** the ultimate impact envelope (vfx/screen.ts): local eased lift + saturation drop + global dip, HDR. The envelope's
 *  values are DISPLAY brightness ratios (what the eye and a frame capture measure); they multiply linear HDR light
 *  raised to the display gamma (≈ 2.2) so a ×1.45 hold reads ×1.45 on screen below the tone curve's shoulder, and the
 *  peak saturates toward the stopped-sun white only inside the area (never full-screen white).
 *  combat F4: the light pours onto the GROUND. A pixel whose scene point stands above it (rebuilt from the stable depth:
 *  0.05 → 0.2 m up eases in, walkable ground is y = 0; bodies down to the ankles, structures, props) takes at most
 *  LIFT_BODY_CAP (and never past display 0.86, so a pale costume does not go white) and keeps its colour, so the struck
 *  unit reads as a silhouette inside the light instead of going white. Only lit pixels read the depth. */
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
uniform highp sampler2D uLiftPre;
uniform float uLiftPreOn;
uniform float uLiftGain;
uniform float uLiftFxGain;
// the display luma the NEUTRAL tone map (three's NeutralToneMapping, exposure 1) makes of a linear colour
float liftDispLuma( vec3 col ) {
  float x = min( col.r, min( col.g, col.b ) );
  col -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( col.r, max( col.g, col.b ) );
  if ( peak >= 0.76 ) {
    float np = 1.0 - 0.0576 / ( peak + 0.24 - 0.76 );
    col *= np / peak;
    col = mix( col, vec3( np ), 1.0 - 1.0 / ( 0.15 * ( peak - np ) + 1.0 ) );
  }
  return pow( max( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 ), 1.0 / 2.2 );
}
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb * pow( max( uExpo, 0.0 ), 2.2 );
  float lift = 0.0, desat = 0.0;
  for ( int i = 0; i < ${MAX_LIFTS}; i ++ ) {
    vec4 a = uLiftA[ i ];
    if ( a.w <= 0.0 ) continue;
    vec2 d = ( uv - a.xy ) * vec2( uAspect, 1.0 );
    float k = 1.0 - smoothstep( a.z * 0.55, a.z * 1.35, length( d ) );
    lift += a.w * ( k * uLiftGain + uBreath * ( 1.0 - k ) );
    desat = max( desat, uLiftB[ i ].x * k );
  }
  float body = 0.0;
  if ( lift > 0.02 && uLiftDepthOn > 0.5 ) {
    float z = texture2D( uLiftDepth, uv ).r;
    vec4 v = uLiftInvProj * vec4( vec3( uv, z ) * 2.0 - 1.0, 1.0 );
    vec3 w = ( uLiftCamWorld * vec4( v.xyz / v.w, 1.0 ) ).xyz;
    body = smoothstep( 0.05, 0.2, w.y ) * step( z, 0.99999 );
    // a pale body part takes less: its display value stops at 0.86 (never the stopped-sun white), a dark one up to the cap
    float bodyV = pow( max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ), 1.0 / 2.2 );
    float capB = clamp( 0.86 / bodyV, 1.0, ${LIFT_BODY_CAP.toFixed(3)} );
    lift = mix( lift, min( lift, capB - 1.0 ), body );
    desat *= 1.0 - body;
  }
  float m = pow( 1.0 + lift, 2.2 );
  // CW1 refix (combat C1): the light the effects ADD (the VFX drawn over the world, plus the bloom it throws: per
  // channel, what rose over the pre-VFX world) is split off and takes the plain capped multiplier (the VFX shaders'
  // vfxLift already holds it to the body cap) and no saturation drop. What stays (the world, and whatever an ink, dust
  // or stone layer darkened it to) is solved through the tone curve and eased toward white as the ground. So an effect
  // inside the beat keeps its kit hue (the solve on ground + light pushed a violet ult toward blue: the ground's own
  // multiplier fell where the light was, and the on - off difference lost the ground's warm channels)
  vec3 fx = vec3( 0.0 );
  if ( lift > 0.02 && uLiftPreOn > 0.5 ) {
    vec3 g = texture2D( uLiftPre, uv ).rgb * pow( max( uExpo, 0.0 ), 2.2 );
    fx = max( c - g, 0.0 );
    c = min( c, g );
  }
  // combat C2: on the GROUND the envelope's ratio is a display ratio through the tone curve too. The NEUTRAL tone map
  // that follows compresses everything over ~0.76 linear, so a plain ×2.4^2.2 read ×1.9-2.2 on a mid-value ground
  // (closing review: Hesmi ×1.93, Marund ×1.58). The ground's multiplier is solved so the TONE-MAPPED display luma is
  // ×(1 + lift), stopping short of white (display ${LIFT_GROUND_TOP}); bodies keep the capped multiplier above.
  if ( lift > 0.05 && body < 0.5 ) {
    float d0 = liftDispLuma( c );
    float target = min( d0 * ( 1.0 + lift ), ${LIFT_GROUND_TOP.toFixed(3)} );
    if ( liftDispLuma( c * m ) < target ) {
      float lo = log2( m ), hi = log2( m ) + 6.0;
      for ( int j = 0; j < 9; j ++ ) {
        float mid = 0.5 * ( lo + hi );
        if ( liftDispLuma( c * exp2( mid ) ) < target ) lo = mid; else hi = mid;
      }
      m = mix( exp2( lo ), m, body * 2.0 );
    }
    // near the top the ground keeps its own tint (the saturation drop eases off): warm light, never a white-out around
    // the struck unit (the victim box stays under the white gate)
    desat *= 1.0 - smoothstep( 0.7, ${LIFT_GROUND_TOP.toFixed(3)}, target );
  }
  c *= m;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  outputColor = vec4( mix( c, vec3( l ), desat ) + fx * uLiftFxGain * pow( 1.0 + lift, 2.2 ), inputColor.a );
}`, {
      blendFunction: BlendFunction.SET,
      uniforms: uniformsOf({
        uLiftA: U.uLiftA, uLiftB: U.uLiftB, uExpo: U.uExpo, uBreath: U.uBreath, uAspect: U.uAspect,
        uLiftDepth: liftDepth.uLiftDepth, uLiftDepthOn: new Uniform(0), uLiftPre: liftDepth.uLiftPre, uLiftPreOn: liftDepth.uLiftPreOn, uLiftGain: liftDepth.uLiftGain, uLiftFxGain: liftDepth.uLiftFxGain, uLiftInvProj: liftDepth.uLiftInvProj, uLiftCamWorld: liftDepth.uLiftCamWorld,
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

/** max env ENV-9: SMAA with a contrast-adaptive sharpen folded into its blend program (one pass, one program). The sharpen
 *  works in a gamma-2 space on the 4-neighbour cross of the pre-AA buffer; its weight falls where the neighbourhood is
 *  already near black or white (CAS's own limiter) and fades out over hard edges (local luma range 0.10 -> 0.22), so an
 *  outline, a health bar or a ring rim never gains a halo; only the soft painted detail of the world is crisped. */
const SHARPEN_TIER: Record<PostQuality['tier'], number> = { low: 0, medium: 0, high: 0.3, ultra: 0.3 };
class SharpSMAAEffect extends SMAAEffect {
  constructor(preset: SMAAPreset, sharp: number) {
    super({ preset });
    const src = this.getFragmentShader();
    const tail = 'outputColor=color;}';
    if (!src.trimEnd().endsWith(tail)) { console.warn('[post] SMAA shader changed: sharpen skipped'); return; }
    this.setFragmentShader(`uniform float uSharp;
${src.trimEnd().slice(0, -tail.length)}
  if ( uSharp > 0.0 ) {
    vec3 pc = sqrt( max( color.rgb, 0.0 ) );
    vec3 pn = sqrt( max( texture2D( inputBuffer, uv + vec2( 0.0, texelSize.y ) ).rgb, 0.0 ) );
    vec3 ps = sqrt( max( texture2D( inputBuffer, uv - vec2( 0.0, texelSize.y ) ).rgb, 0.0 ) );
    vec3 pe = sqrt( max( texture2D( inputBuffer, uv + vec2( texelSize.x, 0.0 ) ).rgb, 0.0 ) );
    vec3 pw = sqrt( max( texture2D( inputBuffer, uv - vec2( texelSize.x, 0.0 ) ).rgb, 0.0 ) );
    vec3 mn = min( pc, min( min( pn, ps ), min( pe, pw ) ) );
    vec3 mx = max( pc, max( max( pn, ps ), max( pe, pw ) ) );
    const vec3 Y = vec3( 0.2126, 0.7152, 0.0722 );
    float range = dot( mx - mn, Y );
    vec3 amp = sqrt( clamp( min( mn, 1.0 - mx ) / max( mx, vec3( 1e-4 ) ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.10, 0.22, range ) );
    float wgt = -dot( amp, Y ) / mix( 8.0, 5.0, uSharp ) * uSharp * 2.0;
    // luma only (no chroma fringes): the sharpened luma's change, carried back to linear on the pixel's own colour
    float lc = dot( pc, Y );
    float lo = clamp( ( lc + wgt * dot( pn + ps + pe + pw, Y ) ) / ( 1.0 + 4.0 * wgt ), 0.0, 1.0 );
    float gain = ( lo * lo ) / max( lc * lc, 1e-5 );
    if ( max( color.r, max( color.g, color.b ) ) <= 1.0 && lc > 0.01 ) color.rgb *= clamp( gain, 0.7, 1.3 );
  }
  outputColor = color;
}`);
    this.uniforms.set('uSharp', new Uniform(sharp));
  }
  set sharp(v: number) { const u = this.uniforms.get('uSharp'); if (u) u.value = v; }
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
  /** the pre-VFX world (CW1 refix, combat C1): blitted from the HDR buffer only while an envelope lifts (a framebuffer
   *  blit: no program, no draw); the exposure effect reads it so the ground's solve never includes the effects' light */
  private pre: WebGLRenderTarget | null = null;
  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    let lifting = false;
    for (const a of U.uLiftA.value) if (a.w > 0) { lifting = true; break; }
    liftDepth.uLiftPreOn.value = 0;
    if (lifting) {
      const w = inputBuffer.width, h = inputBuffer.height;
      if (!this.pre) this.pre = new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter });
      else if (this.pre.width !== w || this.pre.height !== h) this.pre.setSize(w, h);
      renderer.initRenderTarget(this.pre);
      renderer.initRenderTarget(inputBuffer);
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const P = renderer.properties as unknown as { get(o: object): { __webglFramebuffer?: WebGLFramebuffer } };
      const src = P.get(inputBuffer).__webglFramebuffer, dst = P.get(this.pre).__webglFramebuffer;
      if (src && dst && typeof gl.blitFramebuffer === 'function') {
        renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
        renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        liftDepth.uLiftPre.value = this.pre.texture;
        liftDepth.uLiftPreOn.value = 1;
      }
    }
    this.draw(renderer, inputBuffer, this.depth, this.cam());
  }
  override dispose(): void { this.releaseTargets(); super.dispose(); }
  /** round 4 MEM-1 refix: the pre-VFX copy is made at the match's buffer size the first time an envelope lifts (1920×1080
   *  RGBA16F, 16 MB) and stayed at Home after the match; it is made again on the next lift */
  releaseTargets(): void { this.pre?.dispose(); this.pre = null; liftDepth.uLiftPre.value = null; }
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
  private aaEffect: SharpSMAAEffect | null = null;
  /** a harness seam (_harness/max_env_post_ab.mjs): the sharpen strength; null = the tier's own */
  private sharpOverride: number | null = null;
  setSharpen(v: number | null): void {
    this.sharpOverride = v;
    if (this.aaEffect) this.aaEffect.sharp = v ?? SHARPEN_TIER[this.quality.tier];
  }
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
  /** round 4 MEM-1 refix: what the post chain made at a match's size for the match only (renderer teardown) */
  releaseMatchTargets(): void { this.vfx?.releaseTargets(); }

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

  /** a harness seam (_harness/probe_flash_tier.mjs): overrides the no-bloom gains; null = the chain's own */
  private bloomStandIn: { lift: number; fx: number } | null = null;
  setBloomStandIn(gains: { lift: number; fx: number } | null): void {
    this.bloomStandIn = gains;
    this.applyStandIn();
  }
  private applyStandIn(): void {
    const on = !this.quality.bloom;
    liftDepth.uLiftGain.value = this.bloomStandIn?.lift ?? (on ? NO_BLOOM_LIFT_GAIN : 1);
    liftDepth.uLiftFxGain.value = this.bloomStandIn?.fx ?? (on ? NO_BLOOM_FX_GAIN : 1);
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
    this.renderPass = null; this.gradePass = null; this.aaPass = null; this.aaEffect = null; this.aoPass = null; this.lutEffect = null;
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
      ao.configuration.halfRes = true;
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
    // no bloom (Low, or the video setting off): an ultimate's landing would peak 15 luma under High on every map, the
    // light bloom throws around the effect (_harness/probe_flash_tier.mjs). A uniform stands in, inside envelopes only
    this.applyStandIn();
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
      this.aaEffect = new SharpSMAAEffect(preset, this.sharpOverride ?? SHARPEN_TIER[q.tier]);
      this.aaPass = new EffectPass(this.camera, this.aaEffect);
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
