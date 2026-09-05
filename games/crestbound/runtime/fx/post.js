/**
 * CRESTBOUND — runtime/fx/post.js
 * ---------------------------------------------------------------------------
 * The post-processing chain and the colour grade. CONTRACT §7.
 *
 * Chain order:
 *
 *   RenderPass(main scene)          world, into readBuffer
 *   AOPass                          (quality.ssao — ultra) depth-only SSAO
 *   BloomPass                       (quality.bloom) at quality.bloomScale
 *   FinishPass                      lift/gamma/gain, saturation, theme tint,
 *                                   radial vignette, radius-scaled chromatic
 *                                   aberration, animated film grain, flash
 *                                   pulse, damage vignette, heat shimmer,
 *                                   UNDERWATER tint + wobble + caustic vignette,
 *                                   SPEED LINES (radial streaks + radial blur),
 *                                   THEN ACES tone map + sRGB encode
 *   FXAAPass | SMAAPass             (quality.aa) — runs on the ENCODED image
 *
 * Ported from Ascendant (first-person obby). What changed and why:
 *
 *   - ViewmodelPass is GONE. Crestbound is third-person; there are no arms to
 *     composite with a cleared depth buffer. Removing it also removes the
 *     per-frame `_hasContent` walk and one render-target bind.
 *   - FinishPass gained two uniforms + two Post methods:
 *       setUnderwater(v01)  — the swim state. Blue-green tint, a slow
 *                             sinusoidal uv wobble (two low-frequency waves so
 *                             it never reads as a single sliding sheet), and a
 *                             caustic-ish vignette: animated value noise that
 *                             brightens toward the frame edge, the way light
 *                             on a pool floor dances at the periphery of your
 *                             goggles. Eased with damp so surfacing is a swell
 *                             not a pop.
 *       setSpeedLines(v01)  — long jump / dive / speed pad. Radial streaks
 *                             that scroll OUTWARD from a sharp centre, plus a
 *                             4-tap radial blur that grows with radius. The
 *                             centre — where the landing is — stays untouched.
 *   - Bloom threshold default is 0.85 (was 0.86): emissive kill surfaces,
 *     crests, sigils and checkpoint pools glow; plaster, grass and stone do
 *     not. The theme may still override per ThemeDef.bloom.
 *   - aaMode() fallback: a preset with `smaa:false` and no `aa` string gets
 *     FXAA (one draw, no targets) rather than nothing. Crestbound's QUALITY
 *     (contract §2) lists `smaa` only; FXAA is the correct floor for a game
 *     whose renderer is antialias:false by design.
 *
 * WHY THE GRADE AND THE OUTPUT ARE ONE PASS
 * Every pass is a full-screen blit of the whole frame. The grade wrote a linear
 * HDR buffer that OutputPass immediately read back to tone map and encode — two
 * blits to do one pixel's worth of arithmetic. They are a single shader, so the
 * frame is read once and written once. Grade in scene-referred linear -> ACES
 * -> sRGB, in that order.
 *
 * WHY ANTI-ALIASING IS LAST
 * An edge filter on a linear HDR buffer barely softens a neon edge (8.0 vs 0.05
 * blends to 4.0 which still tone maps to ~0.9). After the tone map it blends
 * 0.95 with 0.05 and actually resolves the edge. AA reads the encoded image.
 *
 * COLOUR SPACE: three only applies tone mapping when it renders to the default
 * framebuffer, so every composer target UP TO FinishPass is LINEAR HDR
 * half-float. Nothing in the grade may clamp to 1.0 or the highlight roll-off
 * that sells the look is thrown away. FinishPass converts to display-referred
 * sRGB; everything after it is LDR.
 *
 * ZERO PER-FRAME ALLOCATION: render() touches only numbers and pre-allocated
 * uniform vectors. Every scratch vector is module-scope.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { clamp, clamp01, damp, numOr } from '../core/util.js';

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
// bit-identical to the OutputPass this replaces. The chunk declares the
// toneMappingExposure uniform.
//
// Only the TONE MAP is included. colorspace_pars_fragment is deliberately NOT
// included: three's ShaderMaterial prefix already appends it unconditionally,
// so including it here redefines sRGBTransferOETF and the shader fails to
// compile. The tone map chunk IS needed because the prefix only adds it when
// material.toneMapped is true, and this material sets toneMapped = false so
// three does not ALSO tone map behind us.
#include <tonemapping_pars_fragment>

uniform sampler2D tDiffuse;
uniform vec2  uResolution;
uniform float uTime;

uniform vec3  uLift;
uniform vec3  uGain;
uniform vec3  uGammaInv;
uniform float uContrast;
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
uniform float uUnderwater;
uniform vec3  uWaterTint;
uniform float uSpeedLines;
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

// Two-octave caustic: the classic "sum of two moving noise fields, take the
// sharp ridges" trick. Cheap, and it animates the way pool light does.
float caustic( vec2 p, float t ) {
  float n1 = vnoise( p * 3.1 + vec2( t * 0.21, t * 0.17 ) );
  float n2 = vnoise( p * 4.7 - vec2( t * 0.13, -t * 0.19 ) + 3.7 );
  float ridge = 1.0 - abs( n1 + n2 - 1.0 );
  return ridge * ridge * ridge;
}

vec3 fetch( vec2 uv ) {
  return max( texture2D( tDiffuse, clamp( uv, vec2( 0.0006 ), vec2( 0.9994 ) ) ).rgb, vec3( 0.0 ) );
}

void main() {

  float aspect = uResolution.x / max( uResolution.y, 1.0 );
  vec2 uv = vUv;

  // ---------------------------------------------------------------- heat
  // Cheap screen-space shimmer that lives in the lower part of the frame,
  // where the lava is. Two octaves scrolling upward at different rates so it
  // never reads as a single sliding texture.
  if ( uHeat > 0.0005 ) {
    float band = smoothstep( 0.70, 0.02, uv.y );
    band *= band;
    float n1 = vnoise( vec2( uv.x * 26.0, uv.y * 11.0 - uTime * 1.55 ) );
    float n2 = vnoise( vec2( uv.x * 14.0 + 7.31, uv.y * 6.50 - uTime * 0.92 ) );
    vec2 warp = vec2( ( n1 - 0.5 ) * 1.5 + ( n2 - 0.5 ) * 0.8, ( n2 - 0.5 ) * 0.9 );
    uv += warp * 0.0090 * uHeat * band;
  }

  // ---------------------------------------------------------- underwater
  // Slow sinusoidal wobble: two waves at incommensurate frequencies, so the
  // image swells rather than slides. Amplitude is tiny (≤ 0.6 % of the frame)
  // — the read is "I am under the surface", never "the screen is broken".
  if ( uUnderwater > 0.0005 ) {
    float w1 = sin( uv.y * 9.0 + uTime * 1.35 ) * cos( uv.x * 7.0 - uTime * 0.9 );
    float w2 = sin( uv.x * 13.0 - uTime * 1.7 + uv.y * 4.0 );
    vec2 wob = vec2( w1 * 0.7 + w2 * 0.3, w2 * 0.6 - w1 * 0.4 );
    uv += wob * 0.0060 * uUnderwater;
  }

  uv = clamp( uv, vec2( 0.0006 ), vec2( 0.9994 ) );

  vec2 cc = uv - 0.5;
  float r2 = dot( cc, cc );

  // Half-aspect-corrected radius: fully circular looks wrong on 21:9, fully
  // uv-space looks like an oval on 4:3. rad == 1 at the corners.
  float ax = mix( 1.0, aspect, 0.5 );
  vec2 vd = cc * vec2( ax, 1.0 );
  float rad = length( vd ) / ( 0.5 * sqrt( ax * ax + 1.0 ) );

  // ------------------------------------------------------- aberration
  // Zero at the centre, growing with the square of the radius, so the middle
  // of the screen — where the hero is — stays razor sharp. Speed lines add
  // their own aberration so a dive fringes at the edges.
  vec3 col;
  float chroma = uChroma + uSpeedLines * 1.4;
  if ( chroma > 0.0005 ) {
    vec2 off = cc * ( chroma * ( 0.10 + r2 * 3.10 ) * 0.030 );
    col.r = fetch( uv + off ).r;
    col.g = fetch( uv ).g;
    col.b = fetch( uv - off ).b;
  } else {
    col = fetch( uv );
  }

  // --------------------------------------------------------- speed lines
  // (1) a 4-tap radial blur that grows with radius — the centre stays sharp
  // (2) streaks: value noise sampled on (angle, radius - time) so they scroll
  //     OUTWARD, raised to a high power so only the ridges survive, masked by
  //     radius so nothing crosses the hero.
  if ( uSpeedLines > 0.0005 ) {
    float sl = uSpeedLines;
    float blurAmt = sl * smoothstep( 0.18, 0.95, rad ) * 0.055;
    vec2 dir = cc * blurAmt;
    vec3 acc = col;
    acc += fetch( uv - dir * 0.35 );
    acc += fetch( uv - dir * 0.70 );
    acc += fetch( uv - dir * 1.05 );
    acc += fetch( uv - dir * 1.40 );
    col = mix( col, acc * 0.2, smoothstep( 0.15, 0.8, rad ) * sl );

    float ang = atan( vd.y, vd.x );
    float sn = vnoise( vec2( ang * 9.0 + 41.0, rad * 6.0 - uTime * 9.0 ) );
    sn = max( sn, vnoise( vec2( ang * 17.0 - 13.0, rad * 9.0 - uTime * 13.0 ) ) );
    float streak = pow( sn, 7.0 ) * smoothstep( 0.30, 0.90, rad );
    // taper so streaks are thin lines at the rim and fade in toward the centre
    col += vec3( 0.92, 0.96, 1.0 ) * streak * sl * 2.4;
  }

  // ------------------------------------------------- lift / gamma / gain
  // Classic LGG: lift raises the floor, gain scales the ceiling, gamma bends
  // the middle. Identity is lift 0 / gain 1 / gamma 1.
  col = uLift + col * ( uGain - uLift );
  col = max( col, vec3( 0.0 ) );
  col = pow( col, uGammaInv );

  // ------------------------------------------------------------ contrast
  // A gentle S about scene-linear mid grey (0.18), applied BEFORE the ACES
  // shoulder so blacks go to black and the palette separates without the
  // highlights clipping any earlier than they already do. Identity at 1.0.
  if ( abs( uContrast - 1.0 ) > 0.001 ) {
    col = 0.18 * pow( col * ( 1.0 / 0.18 ), vec3( uContrast ) );
  }

  // ------------------------------------------------- saturation + tint
  float luma = dot( col, LUMA );
  col = mix( vec3( luma ), col, uSaturation );
  col *= uTint;

  // ------------------------------------------------ underwater colour
  // Blue-green absorption (red dies first), a murk lift so blacks go teal,
  // and the caustic vignette: bright dancing ridges that live toward the frame
  // edge and never on the hero.
  if ( uUnderwater > 0.0005 ) {
    float uw = uUnderwater;
    vec3 absorbed = col * uWaterTint;
    absorbed += uWaterTint * 0.045;                       // murk lift
    float lm = dot( absorbed, LUMA );
    absorbed = mix( vec3( lm ), absorbed, 0.86 );          // slight desaturation
    col = mix( col, absorbed, uw );
    float cau = caustic( vd * vec2( 1.0, 1.4 ) + 0.5, uTime );
    float edge = smoothstep( 0.25, 1.0, rad );
    col += uWaterTint * ( 0.9 + 1.6 * cau ) * cau * edge * 0.55 * uw;
    // periphery darkens into the deep
    col *= 1.0 - 0.22 * uw * smoothstep( 0.55, 1.1, rad );
  }

  // ------------------------------------------------------------ vignette
  col *= 1.0 - uVignette * smoothstep( uVignetteSoft, 1.06, rad );

  // -------------------------------------------------------- damage edge
  if ( uDamage > 0.0005 ) {
    float dv = clamp( smoothstep( 0.20, 0.99, rad ) * uDamage, 0.0, 1.0 );
    float lm = max( dot( col, LUMA ), 0.10 );
    col = mix( col, uDamageColor * lm * 2.4, dv * 0.90 );
    col += uDamageColor * dv * 0.22;
    // The whole frame desaturates as the hit lands, not just the edges — this
    // is also what the death rewind rides on (impacts.js holds uDamage high
    // through the 220 ms rewind so the ghost plays back in near-monochrome).
    col = mix( vec3( dot( col, LUMA ) ), col, mix( 1.0, 0.55, clamp( uDamage, 0.0, 1.0 ) ) );
  }

  // -------------------------------------------------------------- pulse
  // A flat full-frame add blows the picture out: at crest strength it lifted
  // the whole sky past white and took the HUD's top-right timer with it. The
  // pulse is LIGHT FROM THE EVENT, so it falls off from the centre where the
  // crest/celebration sits, and it is weighted by headroom (1 - col) so it
  // lifts midtones and shadows and cannot push an already-bright pixel past
  // its own colour. Same lever, same cost, no whiteout.
  if ( uPulse > 0.0001 ) {
    vec2 pd = ( vUv - 0.5 ) * vec2( aspect, 1.0 );
    float fall = 1.0 - smoothstep( 0.12, 0.86, length( pd ) );   // 1 centre -> 0 corners
    vec3 head = clamp( vec3( 1.0 ) - col, vec3( 0.0 ), vec3( 1.0 ) );
    col += uPulseColor * uPulse * ( 0.30 + 0.70 * fall ) * ( 0.22 + 0.78 * head );
  }

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

  // ------------------------------------------------- output dither
  // +/- half an LSB in DISPLAY space, after the OETF — the only place a dither
  // can actually break up 8-bit banding in the sky domes and fog bands.
  gl_FragColor.rgb += ( hash21( gl_FragCoord.xy + vec2( fract( uTime * 13.7 ) * 511.0 ) ) - 0.5 ) * ( 1.2 / 255.0 );
}
`;

/**
 * The shader definition handed to ShaderPass. Kept separate from FinishPass so
 * UniformsUtils.clone() gives every instance its own vectors.
 */
export const GradeShader = {
  name: 'CrestboundFinish',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    // Bound by name into three's tonemapping_pars_fragment chunk.
    toneMappingExposure: { value: 1 },

    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uGammaInv: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },

    uVignette: { value: 0.30 },
    uVignetteSoft: { value: 0.55 },
    uChroma: { value: 0.28 },
    uGrain: { value: 0.020 },

    uPulse: { value: 0 },
    uPulseColor: { value: new THREE.Vector3(1, 1, 1) },
    uDamage: { value: 0 },
    uDamageColor: { value: new THREE.Vector3(1.0, 0.085, 0.055) },
    uHeat: { value: 0 },
    uUnderwater: { value: 0 },
    uWaterTint: { value: new THREE.Vector3(0.30, 0.78, 0.86) },
    uSpeedLines: { value: 0 },
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
  contrast: 1.0,
  saturation: 1.04,
  vignette: 0.30,
  chroma: 0.28,
  tint: null,
  grain: 0.020,
  vignetteSoft: 0.55,
};

/**
 * Neutral bloom. Threshold 0.85: emissive kill surfaces, crests, sigils and
 * checkpoint pools sit well above 1.0 in the HDR buffer and glow; lit plaster,
 * grass and stone peak around 0.6–0.8 under the day key and stay clean.
 */
export const DEFAULT_BLOOM = { strength: 0.62, radius: 0.55, threshold: 0.85 };

/**
 * Ceiling on what the bloom bright-pass may read from the HDR scene buffer.
 * Nothing legitimate in the scene exceeds ~20 (lava crust peaks ≈ 12); a
 * bounded bright-pass is what stops one hot surface flooding the frame white
 * through the mip chain. Presets may LOWER it via `quality.bloomClamp`.
 */
export const DEFAULT_BLOOM_CLAMP = 16;

/** Underwater tint per theme water colour is derived from this when unset. */
export const DEFAULT_WATER_TINT = 0x4dc7dc;

/**
 * The grade pass, which is also the output pass.
 *
 * A ShaderPass subclass so the uniform plumbing has names instead of string
 * keys scattered across the codebase, and so it can mirror OutputPass's
 * behaviour: the tone-map operator and the output colour space are properties
 * of the RENDERER, so the defines are rebuilt (cached) whenever those change,
 * and toneMappingExposure is refreshed every frame — themes drive it.
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

  /** @param {number} v 0..1 */
  setUnderwater(v) { this.uniforms.uUnderwater.value = v; }

  /** @param {number} v 0..1 */
  setSpeedLines(v) { this.uniforms.uSpeedLines.value = v; }

  /** @param {number} r @param {number} g @param {number} b linear-ish multiplier */
  setWaterTint(r, g, b) { this.uniforms.uWaterTint.value.set(r, g, b); }
}

/* ===========================================================================
 * Ambient occlusion (ultra tier)
 * ======================================================================== */

const AO_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4  uInvProj;
uniform float uProj00;
uniform float uProj11;
uniform float uRadius;
uniform float uIntensity;
uniform float uTime;

varying vec2 vUv;

const int   AO_SAMPLES = 10;
const float AO_BIAS = 0.06;
const vec3  LUMA = vec3( 0.2126, 0.7152, 0.0722 );

float hashAo( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 viewPos( vec2 uv, float depth ) {
  vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  vec4 v = uInvProj * clip;
  return v.xyz / v.w;
}

void main() {
  vec4 base = texture2D( tDiffuse, vUv );
  float depth = texture2D( tDepth, vUv ).r;

  // sky / far plane: nothing to occlude
  if ( depth >= 0.9999 ) { gl_FragColor = base; return; }

  vec3 P = viewPos( vUv, depth );
  vec3 N = normalize( cross( dFdx( P ), dFdy( P ) ) );

  // world-space radius projected to uv space at this depth
  float rz = uRadius / max( -P.z, 0.05 );
  vec2 rUv = vec2( uProj00, uProj11 ) * rz * 0.5;

  float ang = hashAo( gl_FragCoord.xy ) * 6.2831853;
  float ca = cos( ang ), sa = sin( ang );

  float occ = 0.0;
  for ( int i = 0; i < AO_SAMPLES; i ++ ) {
    float fi = ( float( i ) + 0.5 ) / float( AO_SAMPLES );
    float a = fi * 6.2831853 * 2.4;              // golden-ish spiral
    float r = sqrt( fi );
    vec2 off = vec2( cos( a ) * ca - sin( a ) * sa, cos( a ) * sa + sin( a ) * ca ) * r * rUv;
    vec2 uv2 = clamp( vUv + off, vec2( 0.001 ), vec2( 0.999 ) );
    float d2 = texture2D( tDepth, uv2 ).r;
    if ( d2 >= 0.9999 ) continue;
    vec3 S = viewPos( uv2, d2 );
    vec3 v = S - P;
    float dist = length( v );
    float fall = 1.0 / ( 1.0 + ( dist / uRadius ) * ( dist / uRadius ) * 4.0 );
    occ += max( 0.0, dot( N, v / max( dist, 1e-4 ) ) - AO_BIAS ) * fall;
  }
  float ao = clamp( 1.0 - ( occ / float( AO_SAMPLES ) ) * uIntensity * 2.6, 0.0, 1.0 );

  // emissive guard: self-lit surfaces (trim, lava, checkpoint pools) must not
  // collect contact shade — their light IS the read.
  float lm = dot( base.rgb, LUMA );
  ao = mix( ao, 1.0, smoothstep( 1.1, 2.6, lm ) );

  gl_FragColor = vec4( base.rgb * ao, base.a );
}
`;

/**
 * Screen-space ambient occlusion from the scene DEPTH alone — no normal
 * buffer, no separate passes, one full-screen draw. Depth-reconstructed view
 * position, derivative normals, 10-tap rotated spiral, luminance-guarded so
 * emissive surfaces keep their glow. The composer's ping-pong targets each
 * carry a DepthTexture (attached in _build); whichever target the world was
 * just rendered into is handed to this pass per frame.
 */
class AOPass extends ShaderPass {
  constructor() {
    super({
      name: 'CrestboundAO',
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uProj00: { value: 1 },
        uProj11: { value: 1 },
        uRadius: { value: 0.7 },
        uIntensity: { value: 0.85 },
        uTime: { value: 0 },
      },
      vertexShader: GRADE_VERT,
      fragmentShader: AO_FRAG,
    });
    this.material.toneMapped = false;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    /** @type {THREE.Camera|null} set by Post so the reconstruction matches */
    this.sceneCamera = null;
    /** configured strength; the uniform is zeroed per-frame when depth is missing */
    this.intensity = 0.85;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const cam = this.sceneCamera;
    if (cam && cam.projectionMatrix) {
      this.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      this.uniforms.uProj00.value = cam.projectionMatrix.elements[0];
      this.uniforms.uProj11.value = cam.projectionMatrix.elements[5];
    }
    // depth lives on the target the world pass just rendered into; the
    // ping-pong buffers alternate across frames, so re-bind every render
    const depth = readBuffer ? readBuffer.depthTexture : null;
    this.uniforms.tDepth.value = depth;
    this.uniforms.uIntensity.value = depth ? this.intensity : 0;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/**
 * UnrealBloomPass that renders its mip chain at a FRACTION of the frame size.
 *
 * Bloom is a blur. Computing a blur at full resolution and then blurring it is
 * paying for detail you are about to destroy. UnrealBloomPass already halves
 * internally (first mip is resolution/2); `scale` multiplies on TOP of that.
 *
 * setSize has to be overridden: EffectComposer.setSize() calls setSize on every
 * pass with the full drawing-buffer size, so a constructor-only scale is
 * silently undone the first time the window is sized.
 */
class ScaledBloomPass extends UnrealBloomPass {
  /**
   * @param {THREE.Vector2} resolution full-frame drawing-buffer size
   * @param {number} strength @param {number} radius @param {number} threshold
   * @param {number} scale 0..1 fraction of the frame to build the mips from
   * @param {number} inputClamp highest value the bright pass may read
   */
  constructor(resolution, strength, radius, threshold, scale, inputClamp) {
    const s = clamp(numOr(scale, 1), 0.125, 1);
    super(
      new THREE.Vector2(
        Math.max(1, Math.round(resolution.x * s)),
        Math.max(1, Math.round(resolution.y * s)),
      ),
      strength, radius, threshold,
    );
    this.bloomScale = s;
    /* GHOST BLOBS (critic, `_shots/keep/vista-ne.png`: "large soft round ghosts
     * float over the geometry at roughly (640,350), (980,290) and (1050,520)
     * with no emitter behind them ... reads as lens dirt").
     *
     * UnrealBloomPass sums five blurred mips with weights [1, .8, .6, .4, .2].
     * The mip chain starts at resolution/2 and this pass scales that again, so
     * at 1920x1080 x 0.5 the coarsest mip is about 60 x 34 texels. ONE bright
     * texel there — a torch, a checkpoint ring, a coin — is a whole 32 x 32
     * pixel disc once it is upsampled, and at weight 0.2 it is bright enough to
     * see. That is the ghost: it is not a lens effect, it is the last two mips.
     *
     * Bloom's job here is a halo AROUND an emitter, not a glow across the room,
     * so the coarse end is attenuated hard. `bloomFactors` is the SAME array
     * object the composite material's uniform holds, so writing into it is the
     * supported way to reweight the chain — no extra pass, no extra fill. */
    const bf = this.compositeMaterial
      && this.compositeMaterial.uniforms.bloomFactors
      && this.compositeMaterial.uniforms.bloomFactors.value;
    if (!Array.isArray(bf) || bf.length < 5) {
      throw new Error('[Post] UnrealBloomPass no longer exposes a 5-entry bloomFactors ' +
        'uniform — the coarse-mip attenuation is stale, re-derive it.');
    }
    bf[2] = 0.42; bf[3] = 0.14; bf[4] = 0.045;
    this._installInputClamp(clamp(numOr(inputClamp, DEFAULT_BLOOM_CLAMP), 1, 1e6));
  }

  /**
   * Clamp what the bright pass is allowed to see. A single half-float-max
   * texel does not stay a dot through a blur: it is spread across the frame
   * and ADDED back, and the whole image saturates. A clamp on the bloom INPUT
   * is the standard guard (Unity and Unreal both ship one). It costs one
   * instruction and makes the pass resolution-independent.
   *
   * @private @param {number} ceiling
   */
  _installInputClamp(ceiling) {
    const mat = this.materialHighPassFilter;
    if (!mat) throw new Error('[Post] UnrealBloomPass has no materialHighPassFilter to clamp');

    const from = 'vec4 texel = texture2D( tDiffuse, vUv );';
    if (mat.fragmentShader.indexOf(from) === -1) {
      throw new Error('[Post] LuminosityHighPassShader no longer starts with the expected ' +
        'texel fetch — the bloom input clamp is stale, re-derive it.');
    }
    const to = [
      'vec4 texel = texture2D( tDiffuse, vUv );',
      '// NaN never compares equal to itself; Inf is caught by the min below.',
      'texel.rgb = mix( vec3( 0.0 ), texel.rgb, vec3( equal( texel.rgb, texel.rgb ) ) );',
      'texel.rgb = clamp( texel.rgb, vec3( 0.0 ), vec3( uBloomClamp ) );',
    ].join('\n');

    mat.fragmentShader = ('uniform float uBloomClamp;\n' +
      mat.fragmentShader.replace(from, to));
    mat.uniforms.uBloomClamp = { value: ceiling };
    this.highPassUniforms.uBloomClamp = mat.uniforms.uBloomClamp;
    mat.needsUpdate = true;
  }

  /** @param {number} v the highest value bloom may see */
  setInputClamp(v) {
    const u = this.materialHighPassFilter && this.materialHighPassFilter.uniforms.uBloomClamp;
    if (u) u.value = clamp(numOr(v, DEFAULT_BLOOM_CLAMP), 1, 1e6);
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
 *    texture() needs derivatives to pick a mip; there are no mips, so
 *    textureLod at level 0 is both correct and cheaper.
 *  - LuminanceData and EdgeData are declared without initialisers.
 *
 * Patched HERE rather than in assets/vendor/: that tree is shared by every game
 * in the repo. The replacements assert, so a reshaped vendored shader throws at
 * load instead of silently shipping the unpatched version.
 */
function fxaaFragment() {
  const patches = [
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

  // ApplyFXAA returns from inside a branch, which is the remaining half of the
  // X4000 warning. Same algorithm, one exit.
  const head = src.indexOf('vec4 ApplyFXAA(');
  const tail = src.indexOf('void main()');
  if (head === -1 || tail === -1 || tail < head) {
    throw new Error('[Post] could not locate ApplyFXAA/main in FXAAShader — ' +
      'the single-exit rewrite is stale, re-derive it against the vendored shader.');
  }
  const singleExit = /* glsl */`vec4 ApplyFXAA( sampler2D tex2D, vec2 texSize, vec2 uv ) {

  LuminanceData luminance = SampleLuminanceNeighborhood( tex2D, texSize, uv );
  vec2 outUv = uv;

  if ( ! ShouldSkipPixel( luminance ) ) {

    float pixelBlend = DeterminePixelBlendFactor( luminance );
    EdgeData edge = DetermineEdge( texSize, luminance );
    float edgeBlend = DetermineEdgeBlendFactor( tex2D, texSize, luminance, edge, uv );
    float finalBlend = max( pixelBlend, edgeBlend );

    if ( edge.isHorizontal ) {
      outUv.y += edge.pixelStep * finalBlend;
    } else {
      outUv.x += edge.pixelStep * finalBlend;
    }

  }

  return Sample( tex2D, outUv );

}

`;
  return src.slice(0, head) + singleExit + src.slice(tail);
}

/**
 * FXAA — one full-screen draw, no render targets of its own. Its `resolution`
 * uniform is the RECIPROCAL of the drawing-buffer size (feeding it pixels makes
 * it sample the same texel every tap and quietly do nothing), so it is set
 * through a named method here.
 */
/* ==========================================================================
 * DYNAMIC RESOLUTION - sub-rectangle rendering (see _harness/_subrect.py)
 * ======================================================================== */

/**
 * RenderPass that draws the scene into the bottom-left `frac x frac` corner of
 * the buffer instead of all of it. `frac === 1` is byte-for-byte the stock
 * behaviour: no viewport is touched and no scissor is enabled.
 */
class ScaledRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    /** fraction of the buffer the scene is rendered into, 0..1 */
    this.frac = 1;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const t = this.renderToScreen ? null : readBuffer;
    const f = this.frac;
    if (t && f < 0.999) {
      const w = Math.max(2, Math.round(t.width * f));
      const h = Math.max(2, Math.round(t.height * f));
      t.viewport.set(0, 0, w, h);
      t.scissor.set(0, 0, w, h);
      t.scissorTest = true;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      t.viewport.set(0, 0, t.width, t.height);
      t.scissor.set(0, 0, t.width, t.height);
      t.scissorTest = false;
      return;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const UpscaleShader = {
  name: 'CrestboundUpscale',
  uniforms: {
    tDiffuse: { value: null },
    /** x,y = the sub-rect as a fraction of the buffer; z,w = half a texel */
    uRect: { value: new THREE.Vector4(1, 1, 0, 0) },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  // map 0..1 onto the sub-rect's TEXEL CENTRES: sampling the outer edge would
  // let the bilinear tap reach the stale pixels outside the rendered region.
  vec2 st = vUv * ( uRect.xy - uRect.zw * 2.0 ) + uRect.zw;
  gl_FragColor = texture2D( tDiffuse, st );
}`,
};

/** One full-screen blit that brings the sub-rect back to full buffer size. */
class UpscalePass extends ShaderPass {
  constructor() {
    super(UpscaleShader);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.toneMapped = false;
    this.enabled = false;
    this._w = 2;
    this._h = 2;
  }

  setBufferSize(w, h) {
    this._w = Math.max(2, Math.round(w));
    this._h = Math.max(2, Math.round(h));
  }

  /** @param {number} f 0..1 */
  setFraction(f) {
    const frac = clamp(numOr(f, 1), 0.1, 1);
    const w = Math.max(2, Math.round(this._w * frac));
    const h = Math.max(2, Math.round(this._h * frac));
    this.uniforms.uRect.value.set(w / this._w, h / this._h,
                                  0.5 / this._w, 0.5 / this._h);
    this.enabled = frac < 0.999;
  }
}

class FXAAPass extends ShaderPass {
  constructor() {
    super({
      name: 'CrestboundFXAA',
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

/* ===========================================================================
 * Contrast-adaptive sharpening (after AA, on the encoded image)
 * ======================================================================== */

/**
 * AMD-CAS-style sharpen. The tiers render BELOW native (CONTRACT hard rule 4:
 * low 0.60) and the compositor's bilinear upscale is what turns world-sign
 * text and every edge to mush (owner, `_shots/_before_visual/verdant-1/
 * spawn.png`). Five taps of the finished LDR frame, a per-pixel amount that
 * is large in flat-ish regions and ZERO across already-hard edges (so it never
 * rings or haloes), applied AFTER FXAA so the anti-aliaser's own soft edges are
 * restored rather than fought. One full-screen draw at buffer size.
 */
const SharpenShader = {
  name: 'CrestboundSharpen',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uSharp: { value: 0.5 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uSharp;
varying vec2 vUv;
void main() {
  vec3 e = texture2D( tDiffuse, vUv ).rgb;
  vec3 b = texture2D( tDiffuse, vUv + vec2( 0.0, -uTexel.y ) ).rgb;
  vec3 d = texture2D( tDiffuse, vUv + vec2( -uTexel.x, 0.0 ) ).rgb;
  vec3 f = texture2D( tDiffuse, vUv + vec2( uTexel.x, 0.0 ) ).rgb;
  vec3 h = texture2D( tDiffuse, vUv + vec2( 0.0, uTexel.y ) ).rgb;
  vec3 mn = min( min( min( b, d ), min( f, h ) ), e );
  vec3 mx = max( max( max( b, d ), max( f, h ) ), e );
  // contrast-adaptive amount: headroom above and below the local extremes
  vec3 amp = clamp( min( mn, 1.0 - mx ) / max( mx, 1e-4 ), 0.0, 1.0 );
  amp = sqrt( amp );
  float peak = mix( 8.0, 5.0, clamp( uSharp, 0.0, 1.0 ) );
  vec3 w = -amp / peak;
  vec3 col = ( ( b + d + f + h ) * w + e ) / ( 4.0 * w + 1.0 );
  gl_FragColor = vec4( clamp( mix( e, col, min( 1.0, uSharp * 1.6 ) ), 0.0, 1.0 ), 1.0 );
}`,
};

class SharpenPass extends ShaderPass {
  constructor() {
    super(SharpenShader);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.toneMapped = false;
    this.enabled = false;
  }

  /** @param {number} w @param {number} h drawing-buffer PIXELS */
  setResolution(w, h) {
    this.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  /** @param {number} v 0..1; below 0.02 the pass is skipped entirely */
  setStrength(v) {
    const s = clamp(numOr(v, 0), 0, 1);
    this.uniforms.uSharp.value = s;
    this.enabled = s >= 0.02;
  }
}

/**
 * Which anti-aliaser a preset wants.
 *
 * `aa: 'smaa'|'fxaa'|'none'` wins when present. Otherwise the contract's
 * `smaa` boolean: true -> SMAA, false -> FXAA. FXAA is the floor (not 'none')
 * because the renderer is antialias:false by design and one extra full-screen
 * draw is always affordable; a preset that genuinely wants no AA says so.
 *
 * @param {object} q a QUALITY preset
 * @returns {'smaa'|'fxaa'|'none'}
 */
function aaMode(q) {
  if (!q) return 'fxaa';
  if (typeof q.aa === 'string') {
    const v = q.aa.toLowerCase();
    if (v === 'smaa' || v === 'fxaa' || v === 'none') return v;
  }
  return q.smaa ? 'smaa' : 'fxaa';
}

/* ===========================================================================
 * Post
 * ======================================================================== */

const _scratchVec3 = new THREE.Vector3();

/**
 * Owns the EffectComposer and every pass in it. The engine constructs exactly
 * one of these and hands it the main scene and camera.
 */
export class Post {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene            main world scene
   * @param {THREE.Camera} camera          main world camera
   * @param {{w:number,h:number}} size     CSS pixels
   * @param {object} quality               a QUALITY preset from core/settings.js
   */
  constructor(renderer, scene, camera, size, quality) {
    if (!renderer) throw new Error('Post: a WebGLRenderer is required');

    this.renderer = renderer;
    this.scene = scene || null;
    this.camera = camera || null;

    const s = normSize(size, renderer);
    this.width = s.w;
    this.height = s.h;

    this.quality = quality || { bloom: true, smaa: false, dpr: 1.5 };

    /** @type {EffectComposer|null} */
    this.composer = null;
    /** @type {RenderPass|null} */      this.renderPass = null;
    /** @type {AOPass|null} */          this.aoPass = null;
    /** @type {UnrealBloomPass|null} */ this.bloomPass = null;
    /** @type {UpscalePass|null} */     this.upscalePass = null;
    /** @type {FinishPass|null} */      this.finishPass = null;
    /** @type {SMAAPass|null} */        this.smaaPass = null;
    /** @type {FXAAPass|null} */        this.fxaaPass = null;
    /** @type {SharpenPass|null} */     this.sharpenPass = null;
    /** @type {THREE.DepthTexture[]} depth attachments created for the AO pass */
    this._depthTextures = [];
    /** CAS strength the engine asked for (survives a chain rebuild) */
    this._sharpen = 0;

    // Persistent state so a quality rebuild does not lose the theme's look.
    this._grade = Object.assign({}, DEFAULT_GRADE);
    this._bloom = Object.assign({}, DEFAULT_BLOOM);
    this._waterTint = new THREE.Vector3(0.30, 0.78, 0.86);

    /** fraction of the composer buffer the SCENE is rendered into (0.1..1) */
    this._frac = 1;
    this.time = 0;
    this._pulseAmt = 0;
    this._pulseT = 0;
    this._pulseDur = 0;
    this._pulseR = 1; this._pulseG = 1; this._pulseB = 1;
    this._damage = 0;
    this._damageTarget = 0;
    this._heat = 0;
    this._heatTarget = 0;
    this._underwater = 0;
    this._underwaterTarget = 0;
    this._speedLines = 0;
    this._speedLinesTarget = 0;

    this._build();
    this.setGrade(this._grade);
    this.setBloom(this._bloom);
    this.setWaterTint(DEFAULT_WATER_TINT);
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

    // 1 — world. REVERTED 2026-09-02: a depth prepass sat here for one pass.
    //     It re-submitted the big merged occluders depth-only, which cost ~67k
    //     extra triangles per course and pushed BOTH courses past the 450k
    //     triangle budget they had previously met (keep 410k -> 515k,
    //     verdant-1 448k -> 541k) while the frame stayed GPU FILL-bound. It did
    //     not pay; the render scale (settings.js QUALITY.renderScale + the
    //     dynamic controller in engine.js) is the mechanism that does.
    this.renderPass = new ScaledRenderPass(this.scene, this.camera);
    this.renderPass.frac = this._frac;
    composer.addPass(this.renderPass);

    // 1.2 - dynamic resolution: bring the scene's sub-rect back to full buffer
    //       size. Disabled (zero draws) whenever the fraction is 1, which is
    //       every frame the dynamic controller has not stepped down.
    this.upscalePass = new UpscalePass();
    this.upscalePass.setBufferSize(w * pr, h * pr);
    this.upscalePass.setFraction(this._frac);
    composer.addPass(this.upscalePass);

    // 1.5 — ambient occlusion (ultra). Each ping-pong target gets its own
    // DepthTexture; the pass re-binds whichever one the world was rendered
    // into every frame.
    if (q.ssao) {
      const rts = [composer.renderTarget1, composer.renderTarget2];
      for (let i = 0; i < rts.length; i++) {
        const rt = rts[i];
        if (rt && !rt.depthTexture) {
          const dt = new THREE.DepthTexture(rt.width, rt.height);
          dt.type = THREE.UnsignedIntType;
          rt.depthTexture = dt;
          this._depthTextures.push(dt);
        }
      }
      this.aoPass = new AOPass();
      this.aoPass.sceneCamera = this.camera;
      composer.addPass(this.aoPass);
    }

    const dw = Math.max(1, Math.round(w * pr));
    const dh = Math.max(1, Math.round(h * pr));

    // 2 — bloom, built from a fraction of the frame (see ScaledBloomPass)
    if (q.bloom) {
      this.bloomPass = new ScaledBloomPass(
        new THREE.Vector2(dw, dh),
        this._bloom.strength, this._bloom.radius, this._bloom.threshold,
        numOr(q.bloomScale, 0.5),
        // min, not override: a preset clamps harder, never disables (see setBloom)
        Math.min(numOr(q.bloomClamp, DEFAULT_BLOOM_CLAMP), numOr(this._bloom.clamp, DEFAULT_BLOOM_CLAMP)),
      );
      composer.addPass(this.bloomPass);
    }

    // 3 — grade + underwater + speed lines + ACES + sRGB, in ONE shader
    this.finishPass = new FinishPass();
    this.finishPass.setResolution(dw, dh);
    composer.addPass(this.finishPass);

    // 4 — anti-aliasing, on the ENCODED image. SMAA is 3 full-screen draws
    //     plus two full-size targets; FXAA is one draw and no targets. SMAA is
    //     for the ultra tier; everything below it gets FXAA.
    const aa = aaMode(q);
    if (aa === 'smaa') {
      this.smaaPass = new SMAAPass(dw, dh);
      composer.addPass(this.smaaPass);
    } else if (aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      this.fxaaPass.setResolution(dw, dh);
      composer.addPass(this.fxaaPass);
    }

    // 5 — contrast-adaptive sharpening, LAST: restores the edges the AA and the
    //     sub-native render scale soften. Disabled (zero draws) at strength 0.
    this.sharpenPass = new SharpenPass();
    this.sharpenPass.setResolution(dw, dh);
    this.sharpenPass.setStrength(this._sharpen);
    composer.addPass(this.sharpenPass);
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
    for (let i = 0; i < this._depthTextures.length; i++) {
      try { this._depthTextures[i].dispose(); } catch (e) { /* ignore */ }
    }
    this._depthTextures.length = 0;
    this.composer = null;
    this.renderPass = null;
    this.upscalePass = null;
    this.aoPass = null;
    this.bloomPass = null;
    this.finishPass = null;
    this.smaaPass = null;
    this.fxaaPass = null;
    this.sharpenPass = null;
  }

  /**
   * Contrast-adaptive sharpening strength, 0..1. The engine drives this from
   * the render scale (`Engine._pushSharpen`): the further below native the
   * frame is drawn, the more of the upscale's softness this buys back.
   * @param {number} v01
   */
  setSharpen(v01) {
    this._sharpen = clamp(numOr(v01, 0), 0, 1);
    if (this.sharpenPass) this.sharpenPass.setStrength(this._sharpen);
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
    cur.contrast = clamp(numOr(src.contrast, DEFAULT_GRADE.contrast), 0.5, 2);
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

    u.uContrast.value = cur.contrast;
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
   * @param {number} [b.clamp]     input ceiling
   */
  setBloom(b) {
    const src = b || {};
    const cur = this._bloom;
    cur.strength = clamp(numOr(src.strength, DEFAULT_BLOOM.strength), 0, 4);
    cur.radius = clamp(numOr(src.radius, DEFAULT_BLOOM.radius), 0, 2);
    cur.threshold = clamp(numOr(src.threshold, DEFAULT_BLOOM.threshold), 0, 8);
    cur.clamp = clamp(numOr(src.clamp, DEFAULT_BLOOM_CLAMP), 1, 1e6);

    const p = this.bloomPass;
    if (!p) return;
    p.strength = cur.strength;
    p.radius = cur.radius;
    p.threshold = cur.threshold;
    // The preset may clamp HARDER than the default but can never disable it.
    p.setInputClamp(Math.min(numOr(this.quality && this.quality.bloomClamp, cur.clamp), cur.clamp));
  }

  /**
   * The absorption colour used by the underwater grade. Themes pass their
   * `palette.water`; the tint is a per-channel multiplier derived from it
   * (red is always suppressed hardest — that is what water does).
   * @param {*} color hex / css / [r,g,b] / THREE.Color
   */
  setWaterTint(color) {
    colorRatio(color, this._waterTint, 0.30, 0.78, 0.86);
    // normalise so the brightest channel is ~0.9: the tint must darken a
    // little (absorption) but never crush the frame.
    const m = Math.max(this._waterTint.x, this._waterTint.y, this._waterTint.z, 1e-3);
    this._waterTint.multiplyScalar(0.9 / m);
    this._waterTint.x = Math.min(this._waterTint.x, 0.55);   // water eats red
    if (this.finishPass) this.finishPass.setWaterTint(this._waterTint.x, this._waterTint.y, this._waterTint.z);
  }

  /**
   * Full-screen additive flash. Decays over `ms` with a quadratic ease-out so
   * it reads as a snap rather than a fade.
   *
   * @param {number} amount peak strength (0.6 death, 1.1 course clear, 0.35 checkpoint)
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
   * Red edge vignette + desaturation. Eased toward the target so a death
   * ramps in instead of popping; call `setDamage(0)` on respawn and it eases
   * back out.
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
   * Heat-shimmer amount. Ember Foundry drives this from the player's proximity
   * to lava; 0 disables the shader branch entirely.
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

  /**
   * Underwater amount. The camera drives this (1 while the lens is below the
   * water plane, 0 above); it eases at lambda 7 so a surface break swells for
   * ~150 ms instead of popping. 0 disables both shader branches.
   * @param {number} v01
   * @param {boolean} [immediate=false]
   */
  setUnderwater(v01, immediate) {
    this._underwaterTarget = clamp01(numOr(v01, 0));
    if (immediate) {
      this._underwater = this._underwaterTarget;
      if (this.finishPass) this.finishPass.setUnderwater(this._underwater);
    }
  }

  /**
   * Radial speed streaks + radial blur. The controller drives this from the
   * long jump / dive / speed pad states (typically 0.6–1.0 at launch, decaying
   * with the move); eased fast (lambda 12) so it lands on the launch frame.
   * @param {number} v01
   * @param {boolean} [immediate=false]
   */
  setSpeedLines(v01, immediate) {
    this._speedLinesTarget = clamp01(numOr(v01, 0));
    if (immediate) {
      this._speedLines = this._speedLinesTarget;
      if (this.finishPass) this.finishPass.setSpeedLines(this._speedLines);
    }
  }

  /** Swap the world scene/camera the chain renders (course transitions). */
  setScene(scene, camera) {
    if (scene) this.scene = scene;
    if (camera) this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = this.scene;
      this.renderPass.camera = this.camera;
    }
    if (this.aoPass) this.aoPass.sceneCamera = this.camera;
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
    if (this.sharpenPass) this.sharpenPass.setResolution(this.width * pr, this.height * pr);
    if (this.upscalePass) {
      this.upscalePass.setBufferSize(this.width * pr, this.height * pr);
      this.upscalePass.setFraction(this._frac);
    }
  }

  /**
   * DYNAMIC RESOLUTION. `f` is the fraction of the composer's buffer the SCENE
   * is rendered into; the post chain always runs at full buffer size, so the
   * grade, the bloom and the AA never change resolution underneath the player.
   *
   * This allocates nothing and disposes nothing - that is the whole point. See
   * `_harness/_subrect.py` and `Engine.setRenderScale`.
   *
   * @param {number} f 0.1..1
   * @returns {number} the fraction actually in effect
   */
  setRenderFraction(f) {
    const frac = clamp(numOr(f, 1), 0.1, 1);
    this._frac = frac;
    if (this.renderPass) this.renderPass.frac = frac;
    if (this.upscalePass) this.upscalePass.setFraction(frac);
    return frac;
  }

  /** the fraction of the buffer the scene is currently rendered into */
  get renderFraction() { return this._frac; }

  /**
   * Swap quality presets. Anything that changes the SHAPE of the chain (whether
   * bloom exists, which anti-aliaser is in it, what fraction bloom renders at,
   * whether AO runs) forces a full rebuild; the old chain is disposed first so
   * nothing leaks a render target. Grade, bloom and every eased amount survive.
   *
   * @param {object} q a QUALITY preset
   */
  setQuality(q) {
    const next = q || this.quality;
    const prev = this.quality;
    const structural =
      !this.composer ||
      !!next.bloom !== !!prev.bloom ||
      !!next.ssao !== !!prev.ssao ||
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
        this.finishPass.setUnderwater(this._underwater);
        this.finishPass.setSpeedLines(this._speedLines);
        this.finishPass.setWaterTint(this._waterTint.x, this._waterTint.y, this._waterTint.z);
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
   * @param {number} dt seconds since the previous frame (REAL time — post
   *                    effects never slow down with the gameplay hit-stop)
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

    // Eased amounts use the framerate-independent damp so they behave
    // identically at 30 and 144 fps.
    this._damage = damp(this._damage, this._damageTarget, 9.0, d);
    if (Math.abs(this._damage - this._damageTarget) < 0.0015) this._damage = this._damageTarget;
    this._heat = damp(this._heat, this._heatTarget, 3.2, d);
    if (Math.abs(this._heat - this._heatTarget) < 0.0015) this._heat = this._heatTarget;
    this._underwater = damp(this._underwater, this._underwaterTarget, 7.0, d);
    if (Math.abs(this._underwater - this._underwaterTarget) < 0.0015) this._underwater = this._underwaterTarget;
    this._speedLines = damp(this._speedLines, this._speedLinesTarget, 12.0, d);
    if (Math.abs(this._speedLines - this._speedLinesTarget) < 0.0015) this._speedLines = this._speedLinesTarget;

    if (pass) {
      pass.setTime(this.time);
      pass.setPulse(pulseV, this._pulseR, this._pulseG, this._pulseB);
      pass.setDamage(this._damage);
      pass.setHeat(this._heat);
      pass.setUnderwater(this._underwater);
      pass.setSpeedLines(this._speedLines);
    }

    if (this.composer) {
      this.composer.render(d);
    } else if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /* ------------------------------------------------------------------ */
  /* introspection (harness + perf HUD)                                  */
  /* ------------------------------------------------------------------ */

  /** current eased amounts, for bootcheck's live-state dump */
  get state() {
    return {
      damage: this._damage, heat: this._heat, underwater: this._underwater,
      speedLines: this._speedLines, pulse: this._pulseAmt, time: this.time,
      passes: this.composer ? this.composer.passes.length : 0,
      aa: aaMode(this.quality), bloom: !!this.bloomPass, ssao: !!this.aoPass,
      sharpen: this._sharpen,
    };
  }

  /** Release every GPU resource this object owns. */
  dispose() {
    this._teardown();
    this.scene = null;
    this.camera = null;
  }
}

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

export default Post;
