/**
 * ASCENDANT — runtime/fx/post.js
 * ---------------------------------------------------------------------------
 * The post-processing chain and the colour grade.
 *
 * Chain order (contract §7):
 *
 *   RenderPass(main scene)          world, into readBuffer
 *   ViewmodelPass(overlay scene)    clears DEPTH then draws the first-person
 *                                   arms into the SAME buffer, so the gloves
 *                                   can never clip world geometry and still
 *                                   receive bloom + grade like everything else
 *   BloomPass                       (quality.bloom) at quality.bloomScale
 *   FinishPass                      lift/gamma/gain, saturation, theme tint,
 *                                   radial vignette, radius-scaled chromatic
 *                                   aberration, animated film grain, flash
 *                                   pulse, damage vignette, heat shimmer,
 *                                   THEN ACES tone map + sRGB encode
 *   FXAAPass | SMAAPass             (quality.aa) — runs on the ENCODED image
 *
 * WHY THE GRADE AND THE OUTPUT ARE ONE PASS
 * Every pass is a full-screen blit of the whole frame. The grade wrote a linear
 * HDR buffer that OutputPass immediately read back to tone map and encode — two
 * blits to do one pixel's worth of arithmetic. They are now a single shader, so
 * the frame is read once and written once. The maths and its ORDER are
 * unchanged (grade in scene-referred linear -> ACES -> sRGB), so the image is
 * identical.
 *
 * WHY ANTI-ALIASING MOVED TO THE END
 * SMAA used to run on the linear HDR buffer, before the tone map. That is the
 * wrong input for an edge filter: on a neon stripe the bright side can sit at
 * luma 8.0 and the dark side at 0.05, so blending them 50/50 gives 4.0, which
 * still tone maps to ~0.9 — the edge barely softens. Anti-aliasing after the
 * tone map blends 0.95 with 0.05 and actually resolves the edge. So AA is now
 * the last pass, reading the encoded image it was designed for. This is a
 * quality fix as much as a cost one.
 *
 * COLOUR SPACE: three only applies tone mapping when it renders to the default
 * framebuffer, so every composer target UP TO FinishPass is LINEAR HDR
 * half-float. The grade therefore runs on scene-referred linear values before
 * the filmic curve — which is where a grade belongs. Nothing in the grade may
 * clamp to 1.0 or the highlight roll-off that sells the look is thrown away.
 * FinishPass is what converts to display-referred sRGB; everything after it is
 * LDR.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { clamp, clamp01, damp, numOr } from '../core/util.js';

/* ===========================================================================
 * Viewmodel overlay pass
 * ======================================================================== */

/**
 * Renders a second scene/camera pair on top of the world with a fresh depth
 * buffer.
 *
 * `needsSwap = false` because it composites INTO the buffer the RenderPass just
 * filled rather than producing a new image; the bloom pass downstream then sees
 * arms and world as one frame, which is what stops the viewmodel from looking
 * pasted on.
 */
class ViewmodelPass extends Pass {
  /**
   * @param {THREE.Scene|null} scene
   * @param {THREE.Camera|null} camera
   */
  constructor(scene, camera) {
    super();
    this.scene = scene || null;
    this.camera = camera || null;
    this.needsSwap = false;
    this.clear = false;
    this.enabled = true;
  }

  setSize(/* width, height */) { /* the overlay follows the main target */ }

  /**
   * True when the overlay actually has something to draw.
   *
   * The old test was `scene.children.length === 0`, which NEVER fired: the
   * engine parks overlayCamera in the overlay scene, so the child count is at
   * minimum 1 even when the arms are hidden. Viewmodel.setVisible(false)
   * removes only the arm root, leaving the camera — so with the viewmodel off
   * (the showViewmodel setting, menus, the death cam) the pass still bound a
   * render target, cleared depth and ran a full renderer.render() of an empty
   * scene, every frame, forever. Counting DRAWABLES is the test that was meant.
   *
   * @private @returns {boolean}
   */
  _hasContent() {
    const kids = this.scene.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (o && o.visible && !o.isCamera) return true;
    }
    return false;
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    const scene = this.scene;
    const camera = this.camera;
    if (scene === null || camera === null) return;
    if (!this._hasContent()) return;

    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    // Wipe depth ONLY. Colour survives, so the arms land on the finished world.
    renderer.clearDepth();
    renderer.render(scene, camera);

    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.scene = null;
    this.camera = null;
  }
}

/* ===========================================================================
 * Grade shader
 * ======================================================================== */

const GRADE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const GRADE_FRAG = /* glsl */`
// Tone map helpers, pulled from three's own shader chunk so the filmic curve is
// bit-identical to the OutputPass this replaces. The chunk is what declares the
// toneMappingExposure uniform.
//
// Only the TONE MAP is included. colorspace_pars_fragment is deliberately NOT
// included: three's ShaderMaterial prefix already appends it unconditionally
// (three.module.js "ShaderChunk[ 'colorspace_pars_fragment' ]" in the fragment
// prefix), so including it here redefines sRGBTransferOETF and the shader fails
// to compile. OutputPass gets away with including it because it is built on
// RawShaderMaterial, which has no prefix at all. The tone map chunk IS needed
// because the prefix only adds it when material.toneMapped is true, and this
// material sets toneMapped = false so three does not ALSO tone map behind us.
#include <tonemapping_pars_fragment>

uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uTime;

uniform vec3  uLift;
uniform vec3  uGain;
uniform vec3  uGammaInv;
uniform float uSaturation;
uniform vec3  uTint;

uniform float uVignette;
uniform float uVignetteSoft;
uniform float uChroma;
uniform float uGrain;

uniform float uPulse;
uniform vec3  uPulseColor;
uniform float uDamage;
uniform vec3  uDamageColor;
uniform float uHeat;
uniform float uClampHi;

varying vec2 vUv;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

float hash21( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

void main() {

  float aspect = uResolution.x / max( uResolution.y, 1.0 );
  vec2 uv = vUv;

  // ---------------------------------------------------------------- heat
  // Cheap screen-space shimmer that lives in the lower part of the frame,
  // where the Lava Foundry's floor is. Two octaves scrolling upward at
  // different rates so it never reads as a single sliding texture.
  if ( uHeat > 0.0005 ) {
    float band = smoothstep( 0.70, 0.02, uv.y );
    band *= band;
    float n1 = vnoise( vec2( uv.x * 26.0, uv.y * 11.0 - uTime * 1.55 ) );
    float n2 = vnoise( vec2( uv.x * 14.0 + 7.31, uv.y * 6.50 - uTime * 0.92 ) );
    vec2 warp = vec2( ( n1 - 0.5 ) * 1.5 + ( n2 - 0.5 ) * 0.8, ( n2 - 0.5 ) * 0.9 );
    uv += warp * 0.0090 * uHeat * band;
    uv = clamp( uv, vec2( 0.0006 ), vec2( 0.9994 ) );
  }

  vec2 cc = uv - 0.5;
  float r2 = dot( cc, cc );

  // ------------------------------------------------------- aberration
  // Zero at the centre, growing with the square of the radius, so the middle
  // of the screen — where the player is aiming a jump — stays razor sharp.
  vec3 col;
  if ( uChroma > 0.0005 ) {
    vec2 off = cc * ( uChroma * ( 0.10 + r2 * 3.10 ) * 0.030 );
    col.r = texture2D( tDiffuse, clamp( uv + off, 0.0, 1.0 ) ).r;
    col.g = texture2D( tDiffuse, uv ).g;
    col.b = texture2D( tDiffuse, clamp( uv - off, 0.0, 1.0 ) ).b;
  } else {
    col = texture2D( tDiffuse, uv ).rgb;
  }
  col = max( col, vec3( 0.0 ) );

  // ------------------------------------------------- lift / gamma / gain
  // Classic LGG: lift raises the floor, gain scales the ceiling, gamma bends
  // the middle. Identity is lift 0 / gain 1 / gamma 1.
  col = uLift + col * ( uGain - uLift );
  col = max( col, vec3( 0.0 ) );
  col = pow( col, uGammaInv );

  // ------------------------------------------------- saturation + tint
  float luma = dot( col, LUMA );
  col = mix( vec3( luma ), col, uSaturation );
  col *= uTint;

  // ------------------------------------------------------------ vignette
  // Half-aspect-corrected: fully circular looks wrong on 21:9, fully
  // uv-space looks like an oval on 4:3. rad == 1 at the corners.
  float ax = mix( 1.0, aspect, 0.5 );
  vec2 vd = cc * vec2( ax, 1.0 );
  float rad = length( vd ) / ( 0.5 * sqrt( ax * ax + 1.0 ) );
  col *= 1.0 - uVignette * smoothstep( uVignetteSoft, 1.06, rad );

  // -------------------------------------------------------- damage edge
  if ( uDamage > 0.0005 ) {
    float dv = clamp( smoothstep( 0.20, 0.99, rad ) * uDamage, 0.0, 1.0 );
    float lm = max( dot( col, LUMA ), 0.10 );
    col = mix( col, uDamageColor * lm * 2.4, dv * 0.90 );
    col += uDamageColor * dv * 0.22;
    // The whole frame desaturates as the hit lands, not just the edges.
    col = mix( vec3( dot( col, LUMA ) ), col, mix( 1.0, 0.55, clamp( uDamage, 0.0, 1.0 ) ) );
  }

  // -------------------------------------------------------------- pulse
  col += uPulseColor * uPulse;

  // -------------------------------------------------------------- grain
  // Animated dither in linear space, weighted so it is present in the mids
  // and shadows and never crawls across a blown highlight.
  if ( uGrain > 0.0001 ) {
    vec2 gp = gl_FragCoord.xy + vec2( fract( uTime * 61.70 ) * 733.0, fract( uTime * 37.31 ) * 941.0 );
    float g = hash21( gp );
    float l2 = dot( col, LUMA );
    col += ( g - 0.5 ) * uGrain * ( 0.30 + min( l2, 1.40 ) );
    col = max( col, vec3( 0.0 ) );
  }

  col = min( col, vec3( uClampHi ) );

  // ------------------------------------------------- tone map + encode
  // Formerly a whole extra full-screen pass (OutputPass). The grade above ran
  // in scene-referred linear and then a SECOND blit read the frame back just to
  // apply these two lines. Same maths, same order, one less read + write of a
  // 1280x720 buffer.
  gl_FragColor = vec4( col, 1.0 );

  #ifdef ACES_FILMIC_TONE_MAPPING
    gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
  #elif defined( AGX_TONE_MAPPING )
    gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
  #elif defined( NEUTRAL_TONE_MAPPING )
    gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
  #elif defined( REINHARD_TONE_MAPPING )
    gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
  #elif defined( CINEON_TONE_MAPPING )
    gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
  #elif defined( LINEAR_TONE_MAPPING )
    gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
  #endif

  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF( gl_FragColor );
  #endif
}
`;

/**
 * The shader definition handed to ShaderPass. Kept separate from FinishPass so
 * UniformsUtils.clone() gives every instance its own vectors.
 */
export const GradeShader = {
  name: 'AscendantFinish',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    // Bound by name into three's tonemapping_pars_fragment chunk.
    toneMappingExposure: { value: 1 },

    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uGammaInv: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },

    uVignette: { value: 0.32 },
    uVignetteSoft: { value: 0.55 },
    uChroma: { value: 0.30 },
    uGrain: { value: 0.022 },

    uPulse: { value: 0 },
    uPulseColor: { value: new THREE.Vector3(1, 1, 1) },
    uDamage: { value: 0 },
    uDamageColor: { value: new THREE.Vector3(1.0, 0.085, 0.055) },
    uHeat: { value: 0 },
    uClampHi: { value: 24 },
  },
  vertexShader: GRADE_VERT,
  fragmentShader: GRADE_FRAG,
};

/** Neutral grade — every field a ThemeDef may override, with a safe default. */
export const DEFAULT_GRADE = {
  lift: 0,
  gamma: 1,
  gain: 1,
  saturation: 1.03,
  vignette: 0.32,
  chroma: 0.30,
  tint: null,
  grain: 0.022,
  vignetteSoft: 0.55,
};

/** Neutral bloom. */
export const DEFAULT_BLOOM = { strength: 0.62, radius: 0.55, threshold: 0.86 };

/**
 * The grade pass, which is also the output pass.
 *
 * A ShaderPass subclass partly so the uniform plumbing has names instead of
 * string keys scattered across the codebase, and partly so it can mirror
 * OutputPass's behaviour: the tone-map operator and the output colour space are
 * properties of the RENDERER, so the defines are rebuilt (cached) whenever
 * those change, and toneMappingExposure is refreshed every frame — themes drive
 * it (engine.applyTheme sets renderer.toneMappingExposure per theme).
 */
export class FinishPass extends ShaderPass {
  constructor() {
    super(GradeShader);
    this.material.toneMapped = false;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this._outputColorSpace = null;
    this._toneMapping = null;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;

    if (this._outputColorSpace !== renderer.outputColorSpace ||
        this._toneMapping !== renderer.toneMapping) {
      this._outputColorSpace = renderer.outputColorSpace;
      this._toneMapping = renderer.toneMapping;

      const defines = {};
      if (THREE.ColorManagement.getTransfer(this._outputColorSpace) === THREE.SRGBTransfer) {
        defines.SRGB_TRANSFER = '';
      }
      const tm = this._toneMapping;
      if (tm === THREE.LinearToneMapping) defines.LINEAR_TONE_MAPPING = '';
      else if (tm === THREE.ReinhardToneMapping) defines.REINHARD_TONE_MAPPING = '';
      else if (tm === THREE.CineonToneMapping) defines.CINEON_TONE_MAPPING = '';
      else if (tm === THREE.ACESFilmicToneMapping) defines.ACES_FILMIC_TONE_MAPPING = '';
      else if (tm === THREE.AgXToneMapping) defines.AGX_TONE_MAPPING = '';
      else if (tm === THREE.NeutralToneMapping) defines.NEUTRAL_TONE_MAPPING = '';

      this.material.defines = defines;
      this.material.needsUpdate = true;
    }

    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  /** @param {number} w @param {number} h drawing-buffer pixels */
  setResolution(w, h) {
    this.uniforms.uResolution.value.set(Math.max(1, w), Math.max(1, h));
  }

  /** @param {number} t seconds */
  setTime(t) { this.uniforms.uTime.value = t; }

  /** @param {number} v @param {number} r @param {number} g @param {number} b */
  setPulse(v, r, g, b) {
    this.uniforms.uPulse.value = v;
    if (r !== undefined) this.uniforms.uPulseColor.value.set(r, g, b);
  }

  /** @param {number} v 0..1 */
  setDamage(v) { this.uniforms.uDamage.value = v; }

  /** @param {number} v 0..1 */
  setHeat(v) { this.uniforms.uHeat.value = v; }
}

/**
 * UnrealBloomPass that renders its mip chain at a FRACTION of the frame size.
 *
 * Bloom is a blur. Computing a blur at full resolution and then blurring it is
 * paying for detail you are about to destroy, which is why half-resolution
 * bloom is standard practice.
 *
 * Note what "resolution" means here: UnrealBloomPass already halves internally
 * (its first mip is resolution/2), so the stock pass constructed at 1280x720
 * was building mips from 640x360 down. `scale` multiplies on TOP of that — at
 * scale 0.5 the chain starts at 320x180, which is a 4x cut in bloom fill.
 *
 * setSize has to be overridden rather than just passing a smaller resolution to
 * the constructor: EffectComposer.setSize() calls setSize on every pass with
 * the full drawing-buffer size, so a constructor-only scale is silently undone
 * the first time the window is sized.
 */
class ScaledBloomPass extends UnrealBloomPass {
  /**
   * @param {THREE.Vector2} resolution full-frame drawing-buffer size
   * @param {number} strength @param {number} radius @param {number} threshold
   * @param {number} scale 0..1 fraction of the frame to build the mips from
   */
  constructor(resolution, strength, radius, threshold, scale) {
    const s = clamp(numOr(scale, 1), 0.125, 1);
    super(
      new THREE.Vector2(
        Math.max(1, Math.round(resolution.x * s)),
        Math.max(1, Math.round(resolution.y * s)),
      ),
      strength, radius, threshold,
    );
    this.bloomScale = s;
  }

  setSize(width, height) {
    const s = this.bloomScale;
    super.setSize(Math.max(2, Math.round(width * s)), Math.max(2, Math.round(height * s)));
  }
}

/**
 * The vendored FXAAShader, with two HLSL warnings compiled out.
 *
 * As shipped it makes D3D11 emit, on every boot:
 *   warning X3595: gradient instruction used in a loop with varying iteration
 *   warning X4000: use of potentially uninitialized variable (f_ApplyFXAA)
 * which trips bootcheck's shader-diagnostics gate. Both are real:
 *
 *  - FXAA samples inside an edge-search loop whose trip count varies per pixel.
 *    texture() needs screen-space derivatives to pick a mip, and derivatives are
 *    undefined under non-uniform control flow. This shader has no mips to pick
 *    from, so the derivative is pure waste as well as undefined: textureLod at
 *    level 0 is both correct and cheaper.
 *  - LuminanceData and EdgeData are declared without initialisers and only
 *    partly assigned on some paths.
 *
 * Patched HERE rather than in assets/vendor/: that tree is shared by every game
 * in the repo, so editing it to suit this one would be a change with a blast
 * radius nobody asked for. The replacements assert, so if a future three
 * version reshapes the shader this throws at load instead of silently shipping
 * the unpatched version.
 */
function fxaaFragment() {
  const patches = [
    // no derivatives => no gradient-in-loop warning, and one less thing for the
    // sampler to compute on every one of FXAA's ~15 taps
    ['return texture( tex2D, uv );', 'return textureLod( tex2D, uv, 0.0 );'],
    ['LuminanceData l;',
      'LuminanceData l = LuminanceData( 0.0, 0.0, 0.0, 0.0, 0.0, ' +
      '0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 );'],
    ['EdgeData e;', 'EdgeData e = EdgeData( false, 0.0, 0.0, 0.0 );'],
  ];
  let src = FXAAShader.fragmentShader;
  for (let i = 0; i < patches.length; i++) {
    const [from, to] = patches[i];
    if (src.indexOf(from) === -1) {
      throw new Error('[Post] FXAAShader no longer contains "' + from +
        '" — the warning patch is stale, re-derive it against the vendored shader.');
    }
    src = src.split(from).join(to);
  }
  return src;
}

/**
 * FXAA — one full-screen draw, no render targets of its own.
 *
 * The cheap half of the AA ladder. Its `resolution` uniform is the RECIPROCAL
 * of the drawing-buffer size, which is easy to get wrong (feeding it pixels
 * instead of 1/pixels makes it sample the same texel every tap and quietly do
 * nothing at all), so it is set through a named method here.
 */
class FXAAPass extends ShaderPass {
  constructor() {
    super({
      name: 'AscendantFXAA',
      uniforms: FXAAShader.uniforms,
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: fxaaFragment(),
    });
    this.material.depthTest = false;
    this.material.depthWrite = false;
  }

  /** @param {number} w @param {number} h drawing-buffer PIXELS */
  setResolution(w, h) {
    this.uniforms.resolution.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }
}

/**
 * Which anti-aliaser a preset wants.
 *
 * Understands the legacy `smaa: true|false` flag so a preset that predates the
 * `aa` field keeps its old meaning instead of silently losing its AA.
 *
 * @param {object} q a QUALITY preset
 * @returns {'smaa'|'fxaa'|'none'}
 */
function aaMode(q) {
  if (!q) return 'none';
  if (typeof q.aa === 'string') {
    const v = q.aa.toLowerCase();
    if (v === 'smaa' || v === 'fxaa' || v === 'none') return v;
  }
  return q.smaa ? 'smaa' : 'none';
}

/* ===========================================================================
 * Post
 * ======================================================================== */

const _scratchVec3 = new THREE.Vector3();

/**
 * Owns the EffectComposer and every pass in it.
 *
 * The engine constructs exactly one of these and hands it the main scene, the
 * main camera and the viewmodel overlay pair.
 */
export class Post {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene            main world scene
   * @param {THREE.Camera} camera          main world camera
   * @param {{w:number,h:number}} size     CSS pixels
   * @param {object} quality               a QUALITY preset from core/settings.js
   * @param {{scene:THREE.Scene, camera:THREE.Camera}} [overlay] viewmodel pair
   */
  constructor(renderer, scene, camera, size, quality, overlay) {
    if (!renderer) throw new Error('Post: a WebGLRenderer is required');

    this.renderer = renderer;
    this.scene = scene || null;
    this.camera = camera || null;

    const s = normSize(size, renderer);
    this.width = s.w;
    this.height = s.h;

    this.overlayScene = overlay && overlay.scene ? overlay.scene : null;
    this.overlayCamera = overlay && overlay.camera ? overlay.camera : null;

    this.quality = quality || { bloom: true, smaa: true, dpr: 1.5 };

    /** @type {EffectComposer|null} */
    this.composer = null;
    /** @type {RenderPass|null} */    this.renderPass = null;
    /** @type {ViewmodelPass|null} */ this.viewmodelPass = null;
    /** @type {UnrealBloomPass|null} */ this.bloomPass = null;
    /** @type {FinishPass|null} */   this.finishPass = null;
    /** @type {SMAAPass|null} */     this.smaaPass = null;
    /** @type {FXAAPass|null} */     this.fxaaPass = null;

    // Persistent state so a quality rebuild does not lose the theme's look.
    this._grade = Object.assign({}, DEFAULT_GRADE);
    this._bloom = Object.assign({}, DEFAULT_BLOOM);

    this.time = 0;
    this._pulseAmt = 0;
    this._pulseT = 0;
    this._pulseDur = 0;
    this._pulseR = 1; this._pulseG = 1; this._pulseB = 1;
    this._damage = 0;
    this._damageTarget = 0;
    this._heat = 0;
    this._heatTarget = 0;

    this._build();
    this.setGrade(this._grade);
    this.setBloom(this._bloom);
  }

  /* ------------------------------------------------------------------ */
  /* chain construction                                                  */
  /* ------------------------------------------------------------------ */

  /** @private */
  _build() {
    const q = this.quality;
    const pr = this.renderer.getPixelRatio();
    const w = this.width;
    const h = this.height;

    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    this.composer = composer;

    // 1 — world
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);

    // 2 — first-person viewmodel, composited with a cleared depth buffer
    this.viewmodelPass = new ViewmodelPass(this.overlayScene, this.overlayCamera);
    composer.addPass(this.viewmodelPass);

    const dw = Math.max(1, Math.round(w * pr));
    const dh = Math.max(1, Math.round(h * pr));

    // 3 — bloom, built from a fraction of the frame (see ScaledBloomPass)
    if (q.bloom) {
      this.bloomPass = new ScaledBloomPass(
        new THREE.Vector2(dw, dh),
        this._bloom.strength, this._bloom.radius, this._bloom.threshold,
        numOr(q.bloomScale, 0.5),
      );
      composer.addPass(this.bloomPass);
    }

    // 4 — grade + ACES + sRGB, in ONE shader (was GradePass then OutputPass)
    this.finishPass = new FinishPass();
    this.finishPass.setResolution(dw, dh);
    composer.addPass(this.finishPass);

    // 5 — anti-aliasing, on the ENCODED image (the renderer itself is
    //     antialias:false by design — MSAA cannot combine with HDR targets).
    //     SMAA is 3 full-screen draws plus two full-size render targets it
    //     owns; FXAA is one draw and no targets at all. SMAA is kept for the
    //     ultra tier, which is explicitly the "my machine is a desk heater"
    //     preset; everything below it gets FXAA.
    const aa = aaMode(q);
    if (aa === 'smaa') {
      this.smaaPass = new SMAAPass(dw, dh);
      composer.addPass(this.smaaPass);
    } else if (aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      this.fxaaPass.setResolution(dw, dh);
      composer.addPass(this.fxaaPass);
    }

    // SSAO is declared by the ultra preset but three ships no SSAO pass in the
    // vendored addon set for this build, so the chain intentionally omits it.
    // Reported here once so a future ultra build does not silently miss it.
    if (q.ssao && !Post._ssaoWarned) {
      Post._ssaoWarned = true;
      console.info('[Post] quality.ssao requested; no SSAO pass is vendored — rendering without it.');
    }
  }

  /** @private Dispose every pass and both composer targets. */
  _teardown() {
    const composer = this.composer;
    if (composer) {
      const passes = composer.passes;
      for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        if (p && typeof p.dispose === 'function') {
          try { p.dispose(); } catch (e) { /* a pass with nothing to free */ }
        }
      }
      passes.length = 0;
      try { composer.dispose(); } catch (e) { /* ignore */ }
    }
    this.composer = null;
    this.renderPass = null;
    this.viewmodelPass = null;
    this.bloomPass = null;
    this.finishPass = null;
    this.smaaPass = null;
    this.fxaaPass = null;
  }

  /* ------------------------------------------------------------------ */
  /* configuration                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a ThemeDef.grade block. Every field is optional; anything omitted
   * falls back to the neutral default rather than to whatever the last theme
   * happened to set, so themes cannot leak into one another.
   *
   * @param {object} g
   * @param {number|number[]} [g.lift]        0 = neutral. Raises the floor.
   * @param {number|number[]} [g.gamma]       1 = neutral. >1 lifts mid-tones.
   * @param {number|number[]} [g.gain]        1 = neutral. Scales highlights.
   * @param {number} [g.saturation]           1 = neutral.
   * @param {number} [g.vignette]             0..1 corner darkening.
   * @param {number} [g.vignetteSoft]         where the vignette starts, 0..1.
   * @param {number} [g.chroma]               0..1 aberration strength.
   * @param {number} [g.grain]                0..0.1 film grain.
   * @param {*} [g.tint]  a colour (hex number, '#rrggbb', [r,g,b] or
   *                      THREE.Color) used as a per-channel MULTIPLIER, or
   *                      {color, amount} to blend it toward neutral.
   */
  setGrade(g) {
    const src = g || {};
    const cur = this._grade;

    cur.lift = pickAny(src.lift, DEFAULT_GRADE.lift);
    cur.gamma = pickAny(src.gamma, DEFAULT_GRADE.gamma);
    cur.gain = pickAny(src.gain, DEFAULT_GRADE.gain);
    cur.saturation = clamp(numOr(src.saturation, DEFAULT_GRADE.saturation), 0, 4);
    cur.vignette = clamp(numOr(src.vignette, DEFAULT_GRADE.vignette), 0, 1.5);
    cur.vignetteSoft = clamp(numOr(src.vignetteSoft, DEFAULT_GRADE.vignetteSoft), 0.05, 1.05);
    cur.chroma = clamp(numOr(src.chroma, DEFAULT_GRADE.chroma), 0, 3);
    cur.grain = clamp(numOr(src.grain, DEFAULT_GRADE.grain), 0, 0.12);
    cur.tint = src.tint === undefined ? DEFAULT_GRADE.tint : src.tint;

    const pass = this.finishPass;
    if (!pass) return;
    const u = pass.uniforms;

    triple(cur.lift, 0, u.uLift.value);
    triple(cur.gain, 1, u.uGain.value);

    triple(cur.gamma, 1, _scratchVec3);
    u.uGammaInv.value.set(
      1 / Math.max(0.05, _scratchVec3.x),
      1 / Math.max(0.05, _scratchVec3.y),
      1 / Math.max(0.05, _scratchVec3.z),
    );

    u.uSaturation.value = cur.saturation;
    u.uVignette.value = cur.vignette;
    u.uVignetteSoft.value = cur.vignetteSoft;
    u.uChroma.value = cur.chroma;
    u.uGrain.value = cur.grain;

    tintMultiplier(cur.tint, u.uTint.value);
  }

  /**
   * @param {object} b
   * @param {number} [b.strength]  0..3
   * @param {number} [b.radius]    0..1
   * @param {number} [b.threshold] luminance above which a pixel blooms
   */
  setBloom(b) {
    const src = b || {};
    const cur = this._bloom;
    cur.strength = clamp(numOr(src.strength, DEFAULT_BLOOM.strength), 0, 4);
    cur.radius = clamp(numOr(src.radius, DEFAULT_BLOOM.radius), 0, 2);
    cur.threshold = clamp(numOr(src.threshold, DEFAULT_BLOOM.threshold), 0, 8);

    const p = this.bloomPass;
    if (!p) return;
    p.strength = cur.strength;
    p.radius = cur.radius;
    p.threshold = cur.threshold;
  }

  /**
   * Full-screen additive flash. Decays over `ms` with a quadratic ease-out so
   * it reads as a snap rather than a fade.
   *
   * @param {number} amount peak strength (0.6 death, 1.1 finish, 0.35 checkpoint)
   * @param {number} ms     duration
   * @param {*} [color]     optional flash colour; defaults to white
   */
  pulse(amount, ms, color) {
    const a = clamp(numOr(amount, 1), 0, 8);
    const d = Math.max(16, numOr(ms, 140)) / 1000;
    // A new pulse never dims an in-flight brighter one.
    const remaining = this._pulseDur > 0 ? this._pulseAmt * sq(this._pulseT / this._pulseDur) : 0;
    this._pulseAmt = Math.max(a, remaining);
    this._pulseDur = d;
    this._pulseT = d;
    if (color !== undefined && color !== null) {
      colorRatio(color, _scratchVec3, 1, 1, 1);
      this._pulseR = _scratchVec3.x;
      this._pulseG = _scratchVec3.y;
      this._pulseB = _scratchVec3.z;
    } else {
      this._pulseR = 1; this._pulseG = 1; this._pulseB = 1;
    }
  }

  /**
   * Red edge vignette. Eased toward the target so a death ramps in instead of
   * popping; call `setDamage(0)` on respawn and it eases back out.
   * @param {number} v01
   */
  setDamage(v01) {
    this._damageTarget = clamp01(numOr(v01, 0));
  }

  /** Snap the damage vignette with no easing (used by the death cam cut). */
  setDamageImmediate(v01) {
    this._damage = this._damageTarget = clamp01(numOr(v01, 0));
    if (this.finishPass) this.finishPass.setDamage(this._damage);
  }

  /**
   * Heat-shimmer amount. The Lava Foundry drives this from the player's
   * proximity to lava; 0 disables the shader branch entirely.
   * @param {number} v01
   * @param {boolean} [immediate=false]
   */
  setHeat(v01, immediate) {
    this._heatTarget = clamp01(numOr(v01, 0));
    if (immediate) {
      this._heat = this._heatTarget;
      if (this.finishPass) this.finishPass.setHeat(this._heat);
    }
  }

  /** Swap the world scene/camera the chain renders (stage transitions). */
  setScene(scene, camera) {
    if (scene) this.scene = scene;
    if (camera) this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = this.scene;
      this.renderPass.camera = this.camera;
    }
  }

  /** Attach or replace the viewmodel overlay pair. */
  setOverlay(scene, camera) {
    this.overlayScene = scene || null;
    this.overlayCamera = camera || null;
    if (this.viewmodelPass) {
      this.viewmodelPass.scene = this.overlayScene;
      this.viewmodelPass.camera = this.overlayCamera;
    }
  }

  /** Show/hide the viewmodel without tearing the chain down. */
  setViewmodelEnabled(v) {
    if (this.viewmodelPass) this.viewmodelPass.enabled = !!v;
  }

  /**
   * @param {number} w CSS pixels
   * @param {number} h CSS pixels
   */
  resize(w, h) {
    this.width = Math.max(1, Math.round(numOr(w, this.width)));
    this.height = Math.max(1, Math.round(numOr(h, this.height)));
    if (!this.composer) return;

    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    // composer.setSize() already pushed the new size into every pass; these two
    // carry uniforms that setSize does not touch.
    if (this.finishPass) this.finishPass.setResolution(this.width * pr, this.height * pr);
    if (this.fxaaPass) this.fxaaPass.setResolution(this.width * pr, this.height * pr);
  }

  /**
   * Swap quality presets. Anything that changes the SHAPE of the chain (whether
   * bloom exists, which anti-aliaser is in it, what fraction bloom renders at)
   * forces a full rebuild; the old chain is disposed first so nothing leaks a
   * render target. The grade and bloom settings survive the rebuild.
   *
   * @param {object} q a QUALITY preset
   */
  setQuality(q) {
    const next = q || this.quality;
    const prev = this.quality;
    const structural =
      !this.composer ||
      !!next.bloom !== !!prev.bloom ||
      aaMode(next) !== aaMode(prev) ||
      numOr(next.bloomScale, 0.5) !== numOr(prev.bloomScale, 0.5);

    this.quality = next;

    if (structural) {
      this._teardown();
      this._build();
      this.setGrade(this._grade);
      this.setBloom(this._bloom);
      if (this.finishPass) {
        this.finishPass.setDamage(this._damage);
        this.finishPass.setHeat(this._heat);
        this.finishPass.setTime(this.time);
      }
    }

    this.resize(this.width, this.height);
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Advance the animated uniforms and draw the frame.
   * @param {number} dt seconds since the previous frame
   */
  render(dt) {
    const d = isFinite(dt) && dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    this.time += d;

    const pass = this.finishPass;

    // Pulse: quadratic ease-out to zero.
    if (this._pulseT > 0) {
      this._pulseT -= d;
      if (this._pulseT <= 0) {
        this._pulseT = 0;
        this._pulseAmt = 0;
      }
    }
    const pulseV = this._pulseDur > 0 && this._pulseT > 0
      ? this._pulseAmt * sq(this._pulseT / this._pulseDur)
      : 0;

    // Damage and heat are eased with the framerate-independent damp so they
    // behave identically at 30 and 144 fps.
    this._damage = damp(this._damage, this._damageTarget, 9.0, d);
    if (Math.abs(this._damage - this._damageTarget) < 0.0015) this._damage = this._damageTarget;
    this._heat = damp(this._heat, this._heatTarget, 3.2, d);
    if (Math.abs(this._heat - this._heatTarget) < 0.0015) this._heat = this._heatTarget;

    if (pass) {
      pass.setTime(this.time);
      pass.setPulse(pulseV, this._pulseR, this._pulseG, this._pulseB);
      pass.setDamage(this._damage);
      pass.setHeat(this._heat);
    }

    if (this.composer) {
      this.composer.render(d);
    } else if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Release every GPU resource this object owns. */
  dispose() {
    this._teardown();
    this.scene = null;
    this.camera = null;
    this.overlayScene = null;
    this.overlayCamera = null;
  }
}

Post._ssaoWarned = false;

/* ===========================================================================
 * helpers
 * ======================================================================== */

function sq(v) { return v * v; }

function pickAny(v, fallback) {
  return v === undefined || v === null ? fallback : v;
}

function normSize(size, renderer) {
  let w = 0;
  let h = 0;
  if (size) {
    w = numOr(size.w, numOr(size.width, numOr(size.x, 0)));
    h = numOr(size.h, numOr(size.height, numOr(size.y, 0)));
  }
  if (!(w > 0) || !(h > 0)) {
    const el = renderer && renderer.domElement ? renderer.domElement : null;
    w = w > 0 ? w : (el && el.clientWidth) || 1280;
    h = h > 0 ? h : (el && el.clientHeight) || 720;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * Write a scalar-or-triple grade value into a Vector3.
 * @param {number|number[]|{x:number,y:number,z:number}} v
 * @param {number} fallback @param {THREE.Vector3} out
 */
function triple(v, fallback, out) {
  if (typeof v === 'number' && isFinite(v)) { out.set(v, v, v); return out; }
  if (Array.isArray(v)) {
    out.set(numOr(v[0], fallback), numOr(v[1], numOr(v[0], fallback)), numOr(v[2], numOr(v[0], fallback)));
    return out;
  }
  if (v && typeof v === 'object' && 'x' in v) {
    out.set(numOr(v.x, fallback), numOr(v.y, fallback), numOr(v.z, fallback));
    return out;
  }
  out.set(fallback, fallback, fallback);
  return out;
}

/**
 * Parse a colour into a raw 0..1 RATIO triple.
 *
 * Deliberately NOT colour-managed: a tint is a per-channel multiplier, not a
 * sample of a colour, so '#ffd9b0' must mean "keep red, take 15 % off green,
 * 31 % off blue" — running it through the sRGB->linear transform would turn a
 * gentle warm push into a heavy orange filter.
 *
 * @param {*} c @param {THREE.Vector3} out
 * @param {number} dr @param {number} dg @param {number} db defaults
 * @returns {THREE.Vector3} out
 */
function colorRatio(c, out, dr, dg, db) {
  if (typeof c === 'number' && isFinite(c)) {
    const h = c | 0;
    out.set(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
    return out;
  }
  if (typeof c === 'string') {
    let s = c.trim();
    if (s.charCodeAt(0) === 35) s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 6) {
      const h = parseInt(s, 16);
      if (isFinite(h)) {
        out.set(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
        return out;
      }
    }
    out.set(dr, dg, db);
    return out;
  }
  if (Array.isArray(c)) {
    out.set(numOr(c[0], dr), numOr(c[1], dg), numOr(c[2], db));
    return out;
  }
  if (c && typeof c === 'object' && typeof c.r === 'number') {
    out.set(c.r, c.g, c.b);
    return out;
  }
  out.set(dr, dg, db);
  return out;
}

/**
 * Resolve ThemeDef.grade.tint into the uTint multiplier.
 * Accepts a bare colour (full-strength multiplier) or {color, amount}.
 * @param {*} tint @param {THREE.Vector3} out
 */
function tintMultiplier(tint, out) {
  if (tint === null || tint === undefined) { out.set(1, 1, 1); return out; }

  if (typeof tint === 'object' && !Array.isArray(tint) && ('color' in tint || 'amount' in tint)) {
    const amt = clamp(numOr(tint.amount, 1), 0, 1);
    colorRatio(tint.color, out, 1, 1, 1);
    out.set(
      1 + (out.x - 1) * amt,
      1 + (out.y - 1) * amt,
      1 + (out.z - 1) * amt,
    );
    return out;
  }

  return colorRatio(tint, out, 1, 1, 1);
}
